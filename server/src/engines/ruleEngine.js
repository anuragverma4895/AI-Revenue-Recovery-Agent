const { FAILURE_CODES, RECOVERY_ACTIONS, RISK_LEVELS, TRANSACTION_STATUS } = require('../config/constants');
const { logger } = require('../utils/logger');

/**
 * Rule Engine
 * 
 * Evaluates transactions against deterministic rules in priority order.
 * First matching rule wins. If no rule matches, returns { matched: false }
 * so the transaction can be forwarded to the AI engine.
 * 
 * Rules are pure functions — no side effects, no database calls.
 */

const RULES = [
  // ── Priority 1: Retry Limit Exceeded ──────────────────────────────────
  {
    id: 'RULE_001',
    name: 'Retry Limit Exceeded',
    description: 'Stop retrying when maximum attempts have been reached',
    condition: (txn) => txn.attemptCount >= txn.maxAttempts,
    action: RECOVERY_ACTIONS.STOP_RETRY,
    actionParams: { delay_minutes: null, max_retries: 0, secondary_action: 'escalate', escalate_if_fails: false },
    riskLevel: RISK_LEVELS.HIGH,
    reason: 'Maximum retry attempts exhausted. No further automatic retries allowed.'
  },

  // ── Priority 2: Invalid / Closed / Blocked Account ────────────────────
  {
    id: 'RULE_002',
    name: 'Invalid Account',
    description: 'Do not retry for permanently invalid accounts',
    condition: (txn) => [
      FAILURE_CODES.INVALID_ACCOUNT,
      FAILURE_CODES.ACCOUNT_CLOSED,
      FAILURE_CODES.ACCOUNT_BLOCKED
    ].includes(txn.failureCode),
    action: RECOVERY_ACTIONS.DO_NOT_RETRY,
    actionParams: { delay_minutes: null, max_retries: 0, secondary_action: null, escalate_if_fails: false },
    riskLevel: RISK_LEVELS.CRITICAL,
    reason: 'Account is invalid, closed, or blocked. Retry will not succeed.'
  },

  // ── Priority 3: Card Expired ──────────────────────────────────────────
  {
    id: 'RULE_003',
    name: 'Card Expired',
    description: 'Request payment method update when card has expired',
    condition: (txn) => txn.failureCode === FAILURE_CODES.CARD_EXPIRED,
    action: RECOVERY_ACTIONS.REQUEST_PAYMENT_UPDATE,
    actionParams: { delay_minutes: null, max_retries: 0, secondary_action: 'send_notification', escalate_if_fails: true },
    riskLevel: RISK_LEVELS.MEDIUM,
    reason: 'Payment card has expired. Customer must update their payment method.'
  },

  // ── Priority 4: Bank Timeout (Retriable) ──────────────────────────────
  {
    id: 'RULE_004',
    name: 'Bank Timeout Retry',
    description: 'Retry payment after bank server timeout',
    condition: (txn) =>
      txn.failureCode === FAILURE_CODES.BANK_TIMEOUT &&
      txn.attemptCount < txn.maxAttempts,
    action: RECOVERY_ACTIONS.RETRY_PAYMENT,
    actionParams: { delay_minutes: 15, max_retries: 2, secondary_action: null, escalate_if_fails: true },
    riskLevel: RISK_LEVELS.MEDIUM,
    reason: 'Bank server timeout is a temporary failure. Safe to retry after a short delay.'
  },

  // ── Priority 5: UPI Timeout (Retriable) ───────────────────────────────
  {
    id: 'RULE_005',
    name: 'UPI Timeout Retry',
    description: 'Retry payment after UPI PSP timeout',
    condition: (txn) =>
      txn.failureCode === FAILURE_CODES.UPI_TIMEOUT &&
      txn.attemptCount < txn.maxAttempts,
    action: RECOVERY_ACTIONS.RETRY_PAYMENT,
    actionParams: { delay_minutes: 10, max_retries: 2, secondary_action: null, escalate_if_fails: true },
    riskLevel: RISK_LEVELS.MEDIUM,
    reason: 'UPI timeout is a temporary issue. Safe to retry after a short delay.'
  },

  // ── Priority 6: Network Error (Retriable) ─────────────────────────────
  {
    id: 'RULE_006',
    name: 'Network Error Retry',
    description: 'Retry payment after transient network error',
    condition: (txn) =>
      txn.failureCode === FAILURE_CODES.NETWORK_ERROR &&
      txn.attemptCount < txn.maxAttempts,
    action: RECOVERY_ACTIONS.RETRY_PAYMENT,
    actionParams: { delay_minutes: 5, max_retries: 2, secondary_action: null, escalate_if_fails: true },
    riskLevel: RISK_LEVELS.LOW,
    reason: 'Network error is transient. Immediate retry is likely to succeed.'
  },

  // ── Priority 7: Insufficient Funds — First Attempt ────────────────────
  {
    id: 'RULE_007',
    name: 'Insufficient Funds - Schedule Retry',
    description: 'Schedule retry for next day (funds may arrive)',
    condition: (txn) =>
      txn.failureCode === FAILURE_CODES.INSUFFICIENT_FUNDS &&
      txn.attemptCount < 2,
    action: RECOVERY_ACTIONS.SCHEDULE_RETRY,
    actionParams: { delay_minutes: 1440, max_retries: 1, secondary_action: null, escalate_if_fails: true },
    riskLevel: RISK_LEVELS.MEDIUM,
    reason: 'Insufficient funds may resolve after salary credit. Schedule retry for next day.'
  },

  // ── Priority 8: Insufficient Funds — Multiple Attempts ────────────────
  {
    id: 'RULE_008',
    name: 'Insufficient Funds - Notify Customer',
    description: 'Notify customer after repeated insufficient funds failures',
    condition: (txn) =>
      txn.failureCode === FAILURE_CODES.INSUFFICIENT_FUNDS &&
      txn.attemptCount >= 2,
    action: RECOVERY_ACTIONS.SEND_NOTIFICATION,
    actionParams: { delay_minutes: null, max_retries: 0, secondary_action: 'escalate', escalate_if_fails: false },
    riskLevel: RISK_LEVELS.HIGH,
    reason: 'Multiple insufficient fund failures. Customer notification required.'
  },

  // ── Priority 9: User Abandoned Checkout ───────────────────────────────
  {
    id: 'RULE_009',
    name: 'Abandoned Checkout Recovery',
    description: 'Send recovery notification for abandoned checkouts',
    condition: (txn) =>
      txn.status === TRANSACTION_STATUS.ABANDONED ||
      txn.failureCode === FAILURE_CODES.USER_ABANDONED,
    action: RECOVERY_ACTIONS.SEND_NOTIFICATION,
    actionParams: { delay_minutes: null, max_retries: 0, secondary_action: null, escalate_if_fails: false },
    riskLevel: RISK_LEVELS.LOW,
    reason: 'Customer abandoned checkout. Send recovery notification to bring them back.'
  },

  // ── Priority 10: Authentication Failed (Retriable) ────────────────────
  {
    id: 'RULE_010',
    name: 'Auth Failed - Retry',
    description: 'Retry after authentication failure (may be temporary)',
    condition: (txn) =>
      txn.failureCode === FAILURE_CODES.AUTH_FAILED &&
      txn.attemptCount < txn.maxAttempts,
    action: RECOVERY_ACTIONS.RETRY_PAYMENT,
    actionParams: { delay_minutes: 30, max_retries: 1, secondary_action: 'send_notification', escalate_if_fails: true },
    riskLevel: RISK_LEVELS.MEDIUM,
    reason: 'Authentication failure may be temporary. Retry after a delay.'
  }
];

/**
 * Evaluate a transaction against the rule engine.
 * @param {Object} transaction - Transaction document
 * @returns {{ matched: boolean, ruleId?: string, ruleName?: string, action?: string, actionParams?: Object, riskLevel?: string, reason?: string }}
 */
const evaluate = (transaction) => {
  for (const rule of RULES) {
    try {
      if (rule.condition(transaction)) {
        logger.info('Rule matched', {
          transactionId: transaction.transactionId,
          ruleId: rule.id,
          ruleName: rule.name,
          action: rule.action
        });

        return {
          matched: true,
          ruleId: rule.id,
          ruleName: rule.name,
          action: rule.action,
          actionParams: { ...rule.actionParams },
          riskLevel: rule.riskLevel,
          reason: rule.reason
        };
      }
    } catch (error) {
      logger.error('Rule evaluation error', {
        ruleId: rule.id,
        transactionId: transaction.transactionId,
        error: error.message
      });
      // Continue to next rule if one fails
    }
  }

  // No rule matched — needs AI analysis
  logger.info('No rule matched, forwarding to AI engine', {
    transactionId: transaction.transactionId,
    failureCode: transaction.failureCode
  });

  return { matched: false };
};

/**
 * Get all rules (for documentation/debugging).
 */
const getRules = () => RULES.map(rule => ({
  id: rule.id,
  name: rule.name,
  description: rule.description,
  action: rule.action,
  riskLevel: rule.riskLevel
}));

module.exports = { evaluate, getRules, RULES };
