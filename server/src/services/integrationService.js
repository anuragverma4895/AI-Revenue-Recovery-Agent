const Transaction = require('../models/Transaction');
const RecoveryCase = require('../models/RecoveryCase');
const { assessRisk } = require('../engines/riskDetector');
const recoveryService = require('./recoveryService');
const auditService = require('./auditService');
const { generateId } = require('../utils/idGenerator');
const { logger } = require('../utils/logger');
const {
  TRANSACTION_STATUS,
  TRANSACTION_SOURCES,
  AUDIT_EVENTS,
  PAYMENT_METHODS
} = require('../config/constants');

/**
 * Integration Service
 * 
 * Orchestrates the flow when a real payment.failed webhook arrives
 * from the Payment Processing System:
 * 
 * 1. Upsert transaction from PPS data
 * 2. Check for existing recovery case (idempotency)
 * 3. Assess risk
 * 4. Trigger recovery analysis (reuses existing analyzeSingle)
 * 5. Log audit events
 */

// Map PPS payment methods to Recovery Agent payment methods
const mapPaymentMethod = (ppsMethod) => {
  const methodMap = {
    'card': PAYMENT_METHODS.CARD,
    'upi': PAYMENT_METHODS.UPI,
    'netbanking': PAYMENT_METHODS.NETBANKING,
    'wallet': PAYMENT_METHODS.WALLET
  };
  return methodMap[ppsMethod] || PAYMENT_METHODS.CARD;
};

// Map PPS failure reasons to failure codes for the rule engine
const mapFailureCode = (failureReason, gatewayResponse) => {
  if (!failureReason) return null;
  const reason = (failureReason || '').toLowerCase();
  const gateway = (gatewayResponse || '').toLowerCase();

  if (reason.includes('timeout') && reason.includes('bank')) return 'BANK_TIMEOUT';
  if (reason.includes('timeout') && reason.includes('upi')) return 'UPI_TIMEOUT';
  if (reason.includes('timeout')) return 'BANK_TIMEOUT';
  if (reason.includes('expired')) return 'CARD_EXPIRED';
  if (reason.includes('insufficient') || reason.includes('funds')) return 'INSUFFICIENT_FUNDS';
  if (reason.includes('invalid') && reason.includes('account')) return 'INVALID_ACCOUNT';
  if (reason.includes('closed')) return 'ACCOUNT_CLOSED';
  if (reason.includes('blocked')) return 'ACCOUNT_BLOCKED';
  if (reason.includes('network')) return 'NETWORK_ERROR';
  if (reason.includes('auth') || reason.includes('authentication')) return 'AUTH_FAILED';
  if (reason.includes('gateway')) return 'GATEWAY_ERROR';
  if (reason.includes('declined') || reason.includes('processor')) return 'PROCESSOR_DECLINED';
  if (reason.includes('abandon')) return 'USER_ABANDONED';
  if (reason.includes('fraud')) return 'FRAUD_SUSPECTED';
  if (reason.includes('duplicate')) return 'DUPLICATE_TRANSACTION';

  // Check gateway response too
  if (gateway.includes('timeout')) return 'BANK_TIMEOUT';
  if (gateway.includes('declined')) return 'PROCESSOR_DECLINED';
  if (gateway.includes('gateway')) return 'GATEWAY_ERROR';

  return 'GATEWAY_ERROR'; // Default for unknown failures
};

/**
 * Handle a payment.failed webhook from the Payment Processing System.
 * 
 * @param {Object} payload - Webhook payload from PPS
 * @returns {Promise<{ duplicate: boolean, transaction?: Object, recoveryCase?: Object }>}
 */
const handlePaymentFailure = async (payload) => {
  const {
    paymentId,
    orderId,
    amount,
    currency,
    status,
    method,
    failureReason,
    timestamp,
    gatewayResponse,
    userId,
    attempts,
    maxAttempts,
    remainingAttempts
  } = payload;

  logger.info('Processing payment failure from PPS', {
    paymentId,
    orderId,
    amount,
    method,
    failureReason
  });

  // ── Step 1: Check for existing transaction with this paymentId ──────────
  const existingTransaction = await Transaction.findOne({ paymentId });
  
  if (existingTransaction) {
    // Check if a recovery case already exists for this transaction
    const existingCase = await RecoveryCase.findOne({ 
      transactionId: existingTransaction.transactionId 
    });
    
    if (existingCase) {
      logger.info('Duplicate payment failure event — case already exists', {
        paymentId,
        transactionId: existingTransaction.transactionId,
        caseId: existingCase.caseId
      });
      return {
        duplicate: true,
        transaction: existingTransaction,
        recoveryCase: existingCase
      };
    }

    // Transaction exists but no case yet — update and continue to analysis
    existingTransaction.status = TRANSACTION_STATUS.FAILED;
    existingTransaction.failureReason = failureReason || existingTransaction.failureReason;
    existingTransaction.failureCode = mapFailureCode(failureReason, gatewayResponse);
    existingTransaction.attemptCount = attempts || existingTransaction.attemptCount;
    existingTransaction.maxAttempts = maxAttempts || existingTransaction.maxAttempts;
    existingTransaction.remainingAttempts = remainingAttempts ?? existingTransaction.remainingAttempts;
    existingTransaction.lastAttemptAt = timestamp ? new Date(timestamp) : new Date();
    existingTransaction.gatewayResponse = gatewayResponse || existingTransaction.gatewayResponse;
    await existingTransaction.save();

    return await analyzeAndCreateCase(existingTransaction);
  }

  // ── Step 2: Create new transaction from PPS data ────────────────────────
  const transactionId = `PPS-${paymentId}`;
  const failureCode = mapFailureCode(failureReason, gatewayResponse);

  const transaction = await Transaction.create({
    transactionId,
    paymentId,
    orderId,
    customerId: userId || `PPS-USER-${orderId}`,
    userId: userId || null,
    customerEmail: `user-${userId || orderId}@pps.internal`,
    customerName: `PPS User ${userId || orderId}`,
    amount,
    currency: currency || 'INR',
    paymentMethod: mapPaymentMethod(method),
    status: TRANSACTION_STATUS.FAILED,
    failureReason: failureReason || 'Payment failed',
    failureCode,
    attemptCount: attempts || 1,
    maxAttempts: maxAttempts || 3,
    remainingAttempts: remainingAttempts ?? null,
    gatewayResponse: gatewayResponse || null,
    lastAttemptAt: timestamp ? new Date(timestamp) : new Date(),
    source: TRANSACTION_SOURCES.PAYMENT_PROCESSING_SYSTEM,
    metadata: {
      customerTotalTransactions: 0,
      customerSuccessRate: 0,
      daysSinceLastSuccess: 0,
      platform: 'api'
    }
  });

  logger.info('Transaction created from PPS webhook', {
    transactionId: transaction.transactionId,
    paymentId,
    orderId,
    amount
  });

  // ── Step 3: Audit log — payment failure received ────────────────────────
  await auditService.createLog({
    eventType: AUDIT_EVENTS.PAYMENT_FAILURE_RECEIVED,
    transactionId: transaction.transactionId,
    reason: `Payment failure received from Payment Processing System: ${failureReason || 'Unknown'}`,
    metadata: {
      paymentId,
      orderId,
      amount,
      currency,
      method,
      source: TRANSACTION_SOURCES.PAYMENT_PROCESSING_SYSTEM,
      attempts,
      maxAttempts,
      remainingAttempts
    }
  });

  // ── Step 4: Analyze and create recovery case ───────────────────────────
  return await analyzeAndCreateCase(transaction);
};

/**
 * Run risk assessment and recovery analysis on a transaction.
 * Reuses the existing recoveryService.analyzeSingle() pipeline.
 */
const analyzeAndCreateCase = async (transaction) => {
  // Assess risk
  const riskAssessment = assessRisk(transaction);

  if (!riskAssessment.atRisk) {
    logger.info('Transaction assessed as not at risk', {
      transactionId: transaction.transactionId
    });
    return {
      duplicate: false,
      transaction,
      recoveryCase: null,
      reason: 'Transaction assessed as not at risk'
    };
  }

  // Check for existing case (safety check)
  const existingCase = await RecoveryCase.findOne({ 
    transactionId: transaction.transactionId 
  });
  if (existingCase) {
    return {
      duplicate: true,
      transaction,
      recoveryCase: existingCase
    };
  }

  // Use existing analyzeSingle to run rule engine → AI engine → policy validation → case creation
  const result = await recoveryService.analyzeSingle(transaction, riskAssessment);

  if (result) {
    // Log case creation
    await auditService.createLog({
      eventType: AUDIT_EVENTS.RECOVERY_CASE_CREATED,
      transactionId: transaction.transactionId,
      caseId: result.caseId,
      action: result.action,
      decisionSource: result.decisionSource,
      reason: `Recovery case auto-created from PPS payment failure. Decision: ${result.action}`,
      metadata: {
        source: TRANSACTION_SOURCES.PAYMENT_PROCESSING_SYSTEM,
        policyApproved: result.policyApproved
      }
    });

    // Log decision
    await auditService.createLog({
      eventType: AUDIT_EVENTS.RECOVERY_DECISION_MADE,
      transactionId: transaction.transactionId,
      caseId: result.caseId,
      action: result.action,
      decisionSource: result.decisionSource,
      reason: `Recovery decision: ${result.action} (source: ${result.decisionSource})`,
      metadata: {
        policyApproved: result.policyApproved
      }
    });

    // Fetch the full case
    const recoveryCase = await RecoveryCase.findOne({ caseId: result.caseId });

    logger.info('Recovery case auto-created from PPS webhook', {
      caseId: result.caseId,
      transactionId: transaction.transactionId,
      action: result.action,
      decisionSource: result.decisionSource,
      policyApproved: result.policyApproved
    });

    return {
      duplicate: false,
      transaction,
      recoveryCase
    };
  }

  return {
    duplicate: false,
    transaction,
    recoveryCase: null,
    reason: 'Analysis did not create a recovery case'
  };
};

module.exports = { handlePaymentFailure };
