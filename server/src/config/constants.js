// ─── Application Constants ───────────────────────────────────────────────────

const TRANSACTION_STATUS = {
  SUCCESS: 'success',
  FAILED: 'failed',
  PENDING: 'pending',
  ABANDONED: 'abandoned'
};

const FAILURE_CODES = {
  BANK_TIMEOUT: 'BANK_TIMEOUT',
  CARD_EXPIRED: 'CARD_EXPIRED',
  INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',
  INVALID_ACCOUNT: 'INVALID_ACCOUNT',
  ACCOUNT_CLOSED: 'ACCOUNT_CLOSED',
  ACCOUNT_BLOCKED: 'ACCOUNT_BLOCKED',
  UPI_TIMEOUT: 'UPI_TIMEOUT',
  NETWORK_ERROR: 'NETWORK_ERROR',
  AUTH_FAILED: 'AUTH_FAILED',
  GATEWAY_ERROR: 'GATEWAY_ERROR',
  PROCESSOR_DECLINED: 'PROCESSOR_DECLINED',
  USER_ABANDONED: 'USER_ABANDONED',
  FRAUD_SUSPECTED: 'FRAUD_SUSPECTED',
  DUPLICATE_TRANSACTION: 'DUPLICATE_TRANSACTION'
};

const RECOVERY_ACTIONS = {
  RETRY_PAYMENT: 'retry_payment',
  SCHEDULE_RETRY: 'schedule_retry',
  REQUEST_PAYMENT_UPDATE: 'request_payment_update',
  SEND_NOTIFICATION: 'send_notification',
  ESCALATE: 'escalate',
  STOP_RETRY: 'stop_retry',
  DO_NOT_RETRY: 'do_not_retry',
  MANUAL_REVIEW: 'manual_review'
};

const CASE_STATUS = {
  OPEN: 'open',
  IN_PROGRESS: 'in_progress',
  RECOVERED: 'recovered',
  FAILED: 'failed',
  ESCALATED: 'escalated',
  CLOSED: 'closed'
};

const RISK_LEVELS = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical'
};

const DECISION_SOURCES = {
  RULE_ENGINE: 'rule_engine',
  AI_ENGINE: 'ai_engine',
  FALLBACK: 'fallback',
  MANUAL: 'manual'
};

const ACTION_STATUS = {
  PENDING: 'pending',
  EXECUTING: 'executing',
  SUCCESS: 'success',
  FAILED: 'failed'
};

const AUDIT_EVENTS = {
  RISK_DETECTED: 'risk_detected',
  RULE_APPLIED: 'rule_applied',
  AI_INVOKED: 'ai_invoked',
  AI_FALLBACK: 'ai_fallback',
  POLICY_APPROVED: 'policy_approved',
  POLICY_REJECTED: 'policy_rejected',
  ACTION_EXECUTED: 'action_executed',
  ACTION_FAILED: 'action_failed',
  CASE_RESOLVED: 'case_resolved',
  CASE_ESCALATED: 'case_escalated',
  SYSTEM_ERROR: 'system_error'
};

const PAYMENT_METHODS = {
  UPI: 'upi',
  CARD: 'card',
  NETBANKING: 'netbanking',
  WALLET: 'wallet'
};

// ─── Policy Constants ────────────────────────────────────────────────────────

const POLICY = {
  allowedActions: Object.values(RECOVERY_ACTIONS),

  blockedActions: [
    'refund',
    'charge_customer',
    'modify_amount',
    'delete_transaction',
    'bypass_authentication'
  ],

  maxTotalRetries: parseInt(process.env.MAX_RETRY_ATTEMPTS) || 5,
  minRetryDelayMinutes: 5,
  maxRetryDelayMinutes: 10080, // 7 days

  maxAutoRecoveryAmount: parseInt(process.env.MAX_AUTO_RECOVERY_AMOUNT) || 100000,

  minAIConfidence: parseFloat(process.env.AI_CONFIDENCE_THRESHOLD) || 0.5,

  actionCooldownMinutes: 10,

  terminalStates: ['success', 'closed', 'do_not_retry']
};

// ─── AI Config ───────────────────────────────────────────────────────────────

const AI_CONFIG = {
  useMockAI: process.env.USE_MOCK_AI !== 'false', // defaults to true
  apiKey: process.env.GEMINI_API_KEY,
  model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
  timeoutMs: parseInt(process.env.GEMINI_TIMEOUT_MS) || 10000,
  validRiskLevels: Object.values(RISK_LEVELS),
  validActions: Object.values(RECOVERY_ACTIONS)
};

// ─── Simulated Execution Success Rates ───────────────────────────────────────

const SIMULATED_SUCCESS_RATES = {
  [RECOVERY_ACTIONS.RETRY_PAYMENT]: 0.65,
  [RECOVERY_ACTIONS.SCHEDULE_RETRY]: 0.55,
  [RECOVERY_ACTIONS.REQUEST_PAYMENT_UPDATE]: 0.40,
  [RECOVERY_ACTIONS.SEND_NOTIFICATION]: 0.30,
  [RECOVERY_ACTIONS.ESCALATE]: 0.0,
  [RECOVERY_ACTIONS.STOP_RETRY]: 0.0,
  [RECOVERY_ACTIONS.DO_NOT_RETRY]: 0.0,
  [RECOVERY_ACTIONS.MANUAL_REVIEW]: 0.0
};

module.exports = {
  TRANSACTION_STATUS,
  FAILURE_CODES,
  RECOVERY_ACTIONS,
  CASE_STATUS,
  RISK_LEVELS,
  DECISION_SOURCES,
  ACTION_STATUS,
  AUDIT_EVENTS,
  PAYMENT_METHODS,
  POLICY,
  AI_CONFIG,
  SIMULATED_SUCCESS_RATES
};
