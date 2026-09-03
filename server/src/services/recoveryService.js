const Transaction = require('../models/Transaction');
const RecoveryCase = require('../models/RecoveryCase');
const { batchAssessRisk } = require('../engines/riskDetector');
const ruleEngine = require('../engines/ruleEngine');
const aiEngine = require('../engines/aiEngine');
const policyValidator = require('../engines/policyValidator');
const auditService = require('./auditService');
const executorService = require('./executorService');
const retryManager = require('./retryManager');
const { generateId } = require('../utils/idGenerator');
const { logger } = require('../utils/logger');
const {
  CASE_STATUS,
  DECISION_SOURCES,
  AUDIT_EVENTS,
  RECOVERY_ACTIONS,
  TRANSACTION_STATUS
} = require('../config/constants');

/**
 * Recovery Service — Main Orchestrator
 * 
 * Coordinates the full recovery workflow:
 * 1. Risk Detection → 2. Rule Engine → 3. AI Engine (if needed)
 * → 4. Policy Validation → 5. Case Creation → 6. Audit Logging
 */

// ─── Analyze All At-Risk Transactions ───────────────────────────────────────

/**
 * Analyze all transactions, detect risk, and create recovery cases.
 * This is the main "batch analysis" function.
 */
const analyzeAll = async () => {
  // Get all non-success transactions that don't already have a case
  const transactions = await Transaction.find({
    status: { $in: [TRANSACTION_STATUS.FAILED, TRANSACTION_STATUS.PENDING, TRANSACTION_STATUS.ABANDONED] }
  }).lean();

  if (transactions.length === 0) {
    return {
      totalTransactions: 0,
      atRiskTransactions: 0,
      casesCreated: 0,
      ruleDecisions: 0,
      aiDecisions: 0,
      fallbackDecisions: 0,
      policyApproved: 0,
      policyRejected: 0
    };
  }

  // Batch risk assessment
  const riskResults = batchAssessRisk(transactions);
  const atRiskResults = riskResults.filter(r => r.riskAssessment.atRisk);

  const summary = {
    totalTransactions: transactions.length,
    atRiskTransactions: atRiskResults.length,
    casesCreated: 0,
    ruleDecisions: 0,
    aiDecisions: 0,
    fallbackDecisions: 0,
    policyApproved: 0,
    policyRejected: 0
  };

  // Process each at-risk transaction
  for (const { transaction, riskAssessment } of atRiskResults) {
    try {
      // Check if case already exists
      const existingCase = await RecoveryCase.findOne({ transactionId: transaction.transactionId });
      if (existingCase) {
        logger.debug('Case already exists, skipping', {
          transactionId: transaction.transactionId,
          caseId: existingCase.caseId
        });
        continue;
      }

      const result = await analyzeSingle(transaction, riskAssessment);

      if (result) {
        summary.casesCreated++;
        if (result.decisionSource === DECISION_SOURCES.RULE_ENGINE) summary.ruleDecisions++;
        else if (result.decisionSource === DECISION_SOURCES.AI_ENGINE) summary.aiDecisions++;
        else if (result.decisionSource === DECISION_SOURCES.FALLBACK) summary.fallbackDecisions++;

        if (result.policyApproved) summary.policyApproved++;
        else summary.policyRejected++;
      }
    } catch (error) {
      logger.error('Error analyzing transaction', {
        transactionId: transaction.transactionId,
        error: error.message
      });
      // Continue with next transaction
    }
  }

  logger.info('Batch analysis complete', summary);
  return summary;
};

// ─── Analyze a Single Transaction ───────────────────────────────────────────

const analyzeSingle = async (transaction, riskAssessment) => {
  // Log risk detection
  await auditService.createLog({
    eventType: AUDIT_EVENTS.RISK_DETECTED,
    transactionId: transaction.transactionId,
    reason: riskAssessment.reason,
    metadata: { riskLevel: riskAssessment.riskLevel, amount: transaction.amount }
  });

  let decisionSource;
  let ruleId = null;
  let decision;
  let aiConfidence = null;
  let aiRawResponse = null;

  // ── Step 1: Try Rule Engine ───────────────────────────────────────────
  const ruleResult = ruleEngine.evaluate(transaction);

  if (ruleResult.matched) {
    // Rule engine handled it
    decisionSource = DECISION_SOURCES.RULE_ENGINE;
    ruleId = ruleResult.ruleId;
    decision = {
      action: ruleResult.action,
      actionParams: ruleResult.actionParams,
      riskLevel: ruleResult.riskLevel,
      reason: ruleResult.reason
    };

    await auditService.createLog({
      eventType: AUDIT_EVENTS.RULE_APPLIED,
      transactionId: transaction.transactionId,
      decisionSource,
      ruleId: ruleResult.ruleId,
      action: ruleResult.action,
      reason: ruleResult.reason
    });

  } else {
    // ── Step 2: Try AI Engine ─────────────────────────────────────────
    const aiResult = await aiEngine.getDecision(transaction);

    if (aiResult.success) {
      decisionSource = DECISION_SOURCES.AI_ENGINE;
      aiConfidence = aiResult.decision.confidence;
      aiRawResponse = aiResult.decision;
      decision = {
        action: aiResult.decision.recovery_action,
        actionParams: {
          delay_minutes: aiResult.decision.delay_minutes || null,
          max_retries: aiResult.decision.max_retries || null,
          secondary_action: aiResult.decision.secondary_action || null,
          escalate_if_fails: aiResult.decision.escalate_if_fails || false
        },
        riskLevel: aiResult.decision.risk_level,
        reason: aiResult.decision.reason
      };

      await auditService.createLog({
        eventType: AUDIT_EVENTS.AI_INVOKED,
        transactionId: transaction.transactionId,
        decisionSource,
        action: decision.action,
        reason: decision.reason,
        confidence: aiConfidence,
        metadata: { mockMode: aiResult.mockMode }
      });

    } else {
      // ── Step 3: Fallback ──────────────────────────────────────────
      decisionSource = DECISION_SOURCES.FALLBACK;
      decision = {
        action: RECOVERY_ACTIONS.MANUAL_REVIEW,
        actionParams: {
          delay_minutes: null,
          max_retries: null,
          secondary_action: null,
          escalate_if_fails: false
        },
        riskLevel: riskAssessment.riskLevel || 'medium',
        reason: `AI engine failed (${aiResult.error}). Falling back to manual review.`
      };

      await auditService.createLog({
        eventType: AUDIT_EVENTS.AI_FALLBACK,
        transactionId: transaction.transactionId,
        decisionSource,
        action: decision.action,
        reason: decision.reason,
        metadata: { aiError: aiResult.error }
      });
    }
  }

  // ── Step 4: Policy Validation ─────────────────────────────────────────
  const policyResult = await policyValidator.validate({
    transaction,
    action: decision.action,
    actionParams: decision.actionParams,
    decisionSource,
    confidence: aiConfidence,
    existingCase: null
  });

  // Log policy result
  await auditService.createLog({
    eventType: policyResult.approved ? AUDIT_EVENTS.POLICY_APPROVED : AUDIT_EVENTS.POLICY_REJECTED,
    transactionId: transaction.transactionId,
    decisionSource,
    action: decision.action,
    reason: policyResult.approved ? 'All policy checks passed' : policyResult.rejectionReason,
    policyApproved: policyResult.approved,
    policyRejectionReason: policyResult.rejectionReason,
    metadata: {
      checksRun: policyResult.checksRun,
      checksPassed: policyResult.checksPassed,
      checksFailed: policyResult.checksFailed
    }
  });

  // ── Step 5: Create Recovery Case ──────────────────────────────────────
  const caseStatus = !policyResult.approved
    ? CASE_STATUS.ESCALATED
    : [RECOVERY_ACTIONS.STOP_RETRY, RECOVERY_ACTIONS.DO_NOT_RETRY].includes(decision.action)
      ? CASE_STATUS.CLOSED
      : CASE_STATUS.OPEN;

  const recoveryCase = await RecoveryCase.create({
    caseId: generateId('RC'),
    transactionId: transaction.transactionId,
    customerId: transaction.customerId,
    status: caseStatus,
    riskLevel: decision.riskLevel,
    amountAtRisk: transaction.amount,
    amountRecovered: 0,
    decisionSource,
    ruleId,
    decisionReason: decision.reason,
    aiConfidence,
    aiRawResponse,
    recommendedAction: decision.action,
    actionParams: decision.actionParams,
    policyApproved: policyResult.approved,
    policyRejectionReason: policyResult.rejectionReason,
    retryCount: 0,
    maxRetries: decision.actionParams.max_retries || 3,
    nextRetryAt: decision.actionParams.delay_minutes
      ? retryManager.calculateNextRetry(0, decision.actionParams.delay_minutes)
      : null
  });

  logger.info('Recovery case created', {
    caseId: recoveryCase.caseId,
    transactionId: transaction.transactionId,
    decisionSource,
    action: decision.action,
    policyApproved: policyResult.approved
  });

  return {
    caseId: recoveryCase.caseId,
    decisionSource,
    action: decision.action,
    policyApproved: policyResult.approved
  };
};

// ─── Execute Recovery for a Single Case ─────────────────────────────────────

const executeCase = async (caseId) => {
  const recoveryCase = await RecoveryCase.findOne({ caseId });
  if (!recoveryCase) {
    throw Object.assign(new Error('Recovery case not found'), { statusCode: 404 });
  }

  if (!recoveryCase.policyApproved) {
    throw Object.assign(
      new Error(`Case ${caseId} was rejected by policy: ${recoveryCase.policyRejectionReason}`),
      { statusCode: 400 }
    );
  }

  if (['recovered', 'closed'].includes(recoveryCase.status)) {
    throw Object.assign(
      new Error(`Case ${caseId} is already ${recoveryCase.status}`),
      { statusCode: 400 }
    );
  }

  const transaction = await Transaction.findOne({ transactionId: recoveryCase.transactionId });
  if (!transaction) {
    throw Object.assign(new Error('Transaction not found'), { statusCode: 404 });
  }

  // Update case status to in_progress
  recoveryCase.status = CASE_STATUS.IN_PROGRESS;
  await recoveryCase.save();

  // Execute the action
  const { duplicate, actionDoc, result } = await executorService.executeAction({
    recoveryCase,
    transaction
  });

  if (duplicate) {
    return {
      caseId: recoveryCase.caseId,
      action: recoveryCase.recommendedAction,
      actionStatus: 'duplicate',
      message: 'Action already executed (idempotency protection)',
      existingAction: actionDoc
    };
  }

  // Update case based on result
  if (result.success) {
    recoveryCase.status = CASE_STATUS.RECOVERED;
    // Use actual recovered amount from PPS if available, otherwise use transaction amount
    recoveryCase.amountRecovered = result.recoveredAmount || transaction.amount;
    recoveryCase.resolvedAt = new Date();

    await auditService.createLog({
      eventType: AUDIT_EVENTS.CASE_RESOLVED,
      transactionId: transaction.transactionId,
      caseId: recoveryCase.caseId,
      actionId: actionDoc.actionId,
      action: recoveryCase.recommendedAction,
      reason: `Revenue recovered: ₹${recoveryCase.amountRecovered.toLocaleString()}`,
      previousState: 'in_progress',
      newState: 'recovered',
      decisionSource: recoveryCase.decisionSource
    });
  } else {
    recoveryCase.retryCount += 1;

    // Check for permanent PPS rejection (order paid, expired, max attempts by PPS)
    if (result.permanent) {
      recoveryCase.status = CASE_STATUS.FAILED;
      recoveryCase.resolvedAt = new Date();

      await auditService.createLog({
        eventType: AUDIT_EVENTS.RECOVERY_RETRY_REJECTED,
        transactionId: transaction.transactionId,
        caseId: recoveryCase.caseId,
        actionId: actionDoc.actionId,
        action: recoveryCase.recommendedAction,
        reason: `Permanent rejection from Payment System: ${result.failureReason || result.message}`,
        previousState: 'in_progress',
        newState: 'failed',
        decisionSource: recoveryCase.decisionSource
      });
    } else {
      // Standard retry/escalation logic
      const retryEligibility = retryManager.canRetry(recoveryCase);

      // Also check PPS remaining attempts
      const ppsRemainingAttempts = result.ppsData?.order?.remainingAttempts;
      const ppsExhausted = ppsRemainingAttempts !== undefined && ppsRemainingAttempts <= 0;

      if (ppsExhausted) {
        recoveryCase.status = CASE_STATUS.FAILED;
        recoveryCase.resolvedAt = new Date();

        await auditService.createLog({
          eventType: AUDIT_EVENTS.RECOVERY_ESCALATED,
          transactionId: transaction.transactionId,
          caseId: recoveryCase.caseId,
          actionId: actionDoc.actionId,
          action: recoveryCase.recommendedAction,
          reason: `Payment System reports no remaining attempts (${ppsRemainingAttempts})`,
          previousState: 'in_progress',
          newState: 'failed',
          decisionSource: recoveryCase.decisionSource
        });
      } else if (retryEligibility.eligible && recoveryCase.actionParams.escalate_if_fails) {
        recoveryCase.status = CASE_STATUS.ESCALATED;
        recoveryCase.resolvedAt = new Date();

        await auditService.createLog({
          eventType: AUDIT_EVENTS.CASE_ESCALATED,
          transactionId: transaction.transactionId,
          caseId: recoveryCase.caseId,
          actionId: actionDoc.actionId,
          action: recoveryCase.recommendedAction,
          reason: `Action failed, escalating as configured. ${retryEligibility.reason}`,
          previousState: 'in_progress',
          newState: 'escalated',
          decisionSource: recoveryCase.decisionSource
        });
      } else if (!retryEligibility.eligible) {
        recoveryCase.status = CASE_STATUS.FAILED;
        recoveryCase.resolvedAt = new Date();

        await auditService.createLog({
          eventType: AUDIT_EVENTS.CASE_ESCALATED,
          transactionId: transaction.transactionId,
          caseId: recoveryCase.caseId,
          actionId: actionDoc.actionId,
          action: recoveryCase.recommendedAction,
          reason: `Recovery failed: ${retryEligibility.reason}`,
          previousState: 'in_progress',
          newState: 'failed',
          decisionSource: recoveryCase.decisionSource
        });
      } else {
        // Can retry — schedule next attempt
        const baseDelay = recoveryCase.actionParams.delay_minutes || 15;
        recoveryCase.nextRetryAt = retryManager.calculateNextRetry(recoveryCase.retryCount, baseDelay);
        recoveryCase.status = CASE_STATUS.OPEN; // Back to open for retry

        await auditService.createLog({
          eventType: AUDIT_EVENTS.ACTION_FAILED,
          transactionId: transaction.transactionId,
          caseId: recoveryCase.caseId,
          actionId: actionDoc.actionId,
          action: recoveryCase.recommendedAction,
          reason: `Action failed. Retry ${recoveryCase.retryCount}/${recoveryCase.maxRetries} scheduled.`,
          previousState: 'in_progress',
          newState: 'open',
          decisionSource: recoveryCase.decisionSource
        });
      }
    }
  }

  await recoveryCase.save();

  return {
    caseId: recoveryCase.caseId,
    action: recoveryCase.recommendedAction,
    actionStatus: actionDoc.status,
    previousState: actionDoc.previousState,
    newState: actionDoc.newState,
    amountRecovered: recoveryCase.amountRecovered,
    result: result
  };
};

// ─── Execute All Pending Cases ──────────────────────────────────────────────

const executeAll = async () => {
  const pendingCases = await RecoveryCase.find({
    status: { $in: [CASE_STATUS.OPEN] },
    policyApproved: true
  });

  const summary = {
    totalExecuted: 0,
    successful: 0,
    failed: 0,
    skipped: 0,
    totalRecovered: 0
  };

  for (const recoveryCase of pendingCases) {
    try {
      const result = await executeCase(recoveryCase.caseId);

      summary.totalExecuted++;
      if (result.actionStatus === 'success') {
        summary.successful++;
        summary.totalRecovered += result.amountRecovered || 0;
      } else if (result.actionStatus === 'duplicate') {
        summary.skipped++;
      } else {
        summary.failed++;
      }
    } catch (error) {
      summary.failed++;
      logger.error('Error executing case', {
        caseId: recoveryCase.caseId,
        error: error.message
      });
    }
  }

  logger.info('Batch execution complete', summary);
  return summary;
};

// ─── Query Helpers ──────────────────────────────────────────────────────────

const getCases = async ({ status, decisionSource, riskLevel, page = 1, limit = 20 } = {}) => {
  const filter = {};
  if (status) filter.status = status;
  if (decisionSource) filter.decisionSource = decisionSource;
  if (riskLevel) filter.riskLevel = riskLevel;

  const total = await RecoveryCase.countDocuments(filter);
  const data = await RecoveryCase.find(filter)
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();

  return {
    data,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
  };
};

const getCaseDetail = async (caseId) => {
  const recoveryCase = await RecoveryCase.findOne({ caseId }).lean();
  if (!recoveryCase) return null;

  const transaction = await Transaction.findOne({ transactionId: recoveryCase.transactionId }).lean();
  const RecoveryAction = require('../models/RecoveryAction');
  const actions = await RecoveryAction.find({ caseId }).sort({ createdAt: 1 }).lean();
  const auditTrail = await auditService.getTrailByTransaction(recoveryCase.transactionId);

  return { case: recoveryCase, transaction, actions, auditTrail };
};

module.exports = { analyzeAll, analyzeSingle, executeCase, executeAll, getCases, getCaseDetail };
