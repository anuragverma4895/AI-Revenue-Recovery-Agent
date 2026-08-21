const { POLICY, DECISION_SOURCES } = require('../config/constants');
const RecoveryAction = require('../models/RecoveryAction');
const RecoveryCase = require('../models/RecoveryCase');
const { logger } = require('../utils/logger');

/**
 * Policy / Safety Validator
 * 
 * Sits between decision (rule/AI) and execution.
 * Enforces hard safety constraints that CANNOT be overridden.
 * 
 * Validation pipeline (9 checks, in order):
 * 1. Transaction not in terminal state
 * 2. Action in allowed list
 * 3. Action NOT in blocked list
 * 4. Retry count < max retries
 * 5. Delay within bounds
 * 6. Amount ≤ max auto-recovery
 * 7. AI confidence ≥ threshold (if AI decision)
 * 8. No duplicate within cooldown
 * 9. Case not already resolved
 */

/**
 * Validate a recovery decision against policy constraints.
 * 
 * @param {Object} params
 * @param {Object} params.transaction - Transaction document
 * @param {string} params.action - Recommended recovery action
 * @param {Object} params.actionParams - Action parameters
 * @param {string} params.decisionSource - "rule_engine" | "ai_engine" | "fallback"
 * @param {number} params.confidence - AI confidence (null for rules)
 * @param {Object} params.existingCase - Existing recovery case (null if new)
 * @returns {Promise<{ approved: boolean, rejectionReason: string|null, checks: Array }>}
 */
const validate = async ({ transaction, action, actionParams, decisionSource, confidence, existingCase }) => {
  const checks = [];
  let approved = true;
  let rejectionReason = null;

  // ── Check 1: Transaction not in terminal state ────────────────────────
  const check1 = {
    name: 'Terminal State Check',
    passed: !POLICY.terminalStates.includes(transaction.status)
  };
  if (!check1.passed) {
    check1.reason = `Transaction is in terminal state "${transaction.status}". No recovery action allowed.`;
    approved = false;
    rejectionReason = check1.reason;
  }
  checks.push(check1);

  // ── Check 2: Action in allowed list ───────────────────────────────────
  const check2 = {
    name: 'Allowed Action Check',
    passed: POLICY.allowedActions.includes(action)
  };
  if (!check2.passed) {
    check2.reason = `Action "${action}" is not in the allowed actions list.`;
    approved = false;
    rejectionReason = rejectionReason || check2.reason;
  }
  checks.push(check2);

  // ── Check 3: Action NOT in blocked list ───────────────────────────────
  const check3 = {
    name: 'Blocked Action Check',
    passed: !POLICY.blockedActions.includes(action)
  };
  if (!check3.passed) {
    check3.reason = `Action "${action}" is explicitly blocked by safety policy. AI must never perform: ${POLICY.blockedActions.join(', ')}`;
    approved = false;
    rejectionReason = rejectionReason || check3.reason;
  }
  checks.push(check3);

  // ── Check 4: Retry count < max retries ────────────────────────────────
  const currentRetries = existingCase ? existingCase.retryCount : 0;
  const check4 = {
    name: 'Retry Limit Check',
    passed: currentRetries < POLICY.maxTotalRetries
  };
  if (!check4.passed && ['retry_payment', 'schedule_retry'].includes(action)) {
    check4.reason = `Retry limit exceeded (${currentRetries}/${POLICY.maxTotalRetries}). No more retries allowed.`;
    approved = false;
    rejectionReason = rejectionReason || check4.reason;
  } else {
    check4.passed = true; // Not a retry action, skip this check
  }
  checks.push(check4);

  // ── Check 5: Delay within bounds ──────────────────────────────────────
  const delay = actionParams?.delay_minutes;
  const check5 = { name: 'Delay Bounds Check', passed: true };
  if (delay !== null && delay !== undefined) {
    if (delay < POLICY.minRetryDelayMinutes || delay > POLICY.maxRetryDelayMinutes) {
      check5.passed = false;
      check5.reason = `Retry delay ${delay}min is outside allowed bounds [${POLICY.minRetryDelayMinutes}, ${POLICY.maxRetryDelayMinutes}].`;
      approved = false;
      rejectionReason = rejectionReason || check5.reason;
    }
  }
  checks.push(check5);

  // ── Check 6: Amount ≤ max auto-recovery ───────────────────────────────
  const check6 = {
    name: 'Amount Limit Check',
    passed: transaction.amount <= POLICY.maxAutoRecoveryAmount
  };
  if (!check6.passed && ['retry_payment', 'schedule_retry'].includes(action)) {
    check6.reason = `Transaction amount ₹${transaction.amount.toLocaleString()} exceeds auto-recovery limit ₹${POLICY.maxAutoRecoveryAmount.toLocaleString()}. Manual review required.`;
    approved = false;
    rejectionReason = rejectionReason || check6.reason;
  } else {
    check6.passed = true; // Not a retry action or within limit
  }
  checks.push(check6);

  // ── Check 7: AI confidence ≥ threshold ────────────────────────────────
  const check7 = { name: 'AI Confidence Check', passed: true };
  if (decisionSource === DECISION_SOURCES.AI_ENGINE && confidence !== null && confidence !== undefined) {
    if (confidence < POLICY.minAIConfidence) {
      check7.passed = false;
      check7.reason = `AI confidence ${confidence.toFixed(2)} is below minimum threshold ${POLICY.minAIConfidence}. Decision not reliable enough.`;
      approved = false;
      rejectionReason = rejectionReason || check7.reason;
    }
  }
  checks.push(check7);

  // ── Check 8: No duplicate within cooldown ─────────────────────────────
  const check8 = { name: 'Action Cooldown Check', passed: true };
  try {
    if (existingCase) {
      const recentAction = await RecoveryAction.findOne({
        caseId: existingCase.caseId,
        action: action,
        createdAt: {
          $gte: new Date(Date.now() - POLICY.actionCooldownMinutes * 60 * 1000)
        }
      });

      if (recentAction) {
        const minutesAgo = Math.round((Date.now() - new Date(recentAction.createdAt).getTime()) / (60 * 1000));
        check8.passed = false;
        check8.reason = `Action cooldown active. Same action "${action}" was performed ${minutesAgo}min ago. Cooldown is ${POLICY.actionCooldownMinutes}min.`;
        approved = false;
        rejectionReason = rejectionReason || check8.reason;
      }
    }
  } catch (error) {
    logger.error('Cooldown check DB error, allowing action', { error: error.message });
    // On DB error, allow the action (fail open for this check)
  }
  checks.push(check8);

  // ── Check 9: Case not already resolved ────────────────────────────────
  const check9 = { name: 'Case Resolved Check', passed: true };
  if (existingCase && ['recovered', 'closed'].includes(existingCase.status)) {
    check9.passed = false;
    check9.reason = `Recovery case "${existingCase.caseId}" is already ${existingCase.status}. No further actions allowed.`;
    approved = false;
    rejectionReason = rejectionReason || check9.reason;
  }
  checks.push(check9);

  // ── Final result ──────────────────────────────────────────────────────
  const result = {
    approved,
    rejectionReason,
    checks,
    checksRun: checks.length,
    checksPassed: checks.filter(c => c.passed).length,
    checksFailed: checks.filter(c => !c.passed).length
  };

  logger.info('Policy validation complete', {
    transactionId: transaction.transactionId,
    action,
    approved,
    rejectionReason,
    checksRun: result.checksRun,
    checksFailed: result.checksFailed
  });

  return result;
};

module.exports = { validate };
