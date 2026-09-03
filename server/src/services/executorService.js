const RecoveryAction = require('../models/RecoveryAction');
const Transaction = require('../models/Transaction');
const { SIMULATED_SUCCESS_RATES, ACTION_STATUS, TRANSACTION_STATUS, TRANSACTION_SOURCES, AUDIT_EVENTS } = require('../config/constants');
const { generateId, generateIdempotencyKey } = require('../utils/idGenerator');
const { logger } = require('../utils/logger');
const paymentClient = require('./paymentClient');
const auditService = require('./auditService');

/**
 * Recovery Action Executor
 * 
 * Executes bounded recovery actions.
 * 
 * For seed/demo transactions: uses simulated outcomes (deterministic hash).
 * For PPS-integrated transactions: makes real HTTP calls to Payment Processing System.
 * 
 * Key safety property: only executes whitelisted actions through the
 * action handler map — unknown actions are rejected.
 */

// ─── Deterministic Hash for Simulated Outcomes ──────────────────────────────

const hashCode = (str) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
};

/**
 * Determine simulated success/failure based on transaction ID.
 * Same transactionId + action always produces the same outcome.
 * Used ONLY for seed/demo data.
 */
const simulateOutcome = (transactionId, action, attemptNumber = 1) => {
  const seed = hashCode(`${transactionId}:${action}:${attemptNumber}`);
  const threshold = SIMULATED_SUCCESS_RATES[action] || 0;
  const roll = (seed % 100) / 100;
  return roll < threshold;
};

// ─── Action Handlers ────────────────────────────────────────────────────────

const actionHandlers = {
  retry_payment: async (transaction, actionParams, recoveryCase) => {
    // ── REAL integration for PPS transactions ──────────────────────────
    if (transaction.source === TRANSACTION_SOURCES.PAYMENT_PROCESSING_SYSTEM) {
      return await handleRealRetry(transaction, actionParams, recoveryCase);
    }

    // ── Simulated for seed/demo data ───────────────────────────────────
    const success = simulateOutcome(transaction.transactionId, 'retry_payment', transaction.attemptCount);
    return {
      success,
      message: success
        ? 'Payment retry successful. Transaction completed.'
        : 'Payment retry failed. Bank returned error on retry attempt.',
      simulatedOutcome: success ? 'Payment processed successfully' : 'Bank declined retry attempt',
      newStatus: success ? TRANSACTION_STATUS.SUCCESS : TRANSACTION_STATUS.FAILED
    };
  },

  schedule_retry: async (transaction, actionParams) => {
    const success = simulateOutcome(transaction.transactionId, 'schedule_retry', transaction.attemptCount);
    const delayMinutes = actionParams?.delay_minutes || 60;
    return {
      success,
      message: success
        ? `Scheduled retry executed successfully after ${delayMinutes}min delay.`
        : `Scheduled retry failed after ${delayMinutes}min delay.`,
      simulatedOutcome: success ? 'Delayed retry succeeded' : 'Delayed retry also failed',
      newStatus: success ? TRANSACTION_STATUS.SUCCESS : TRANSACTION_STATUS.FAILED
    };
  },

  request_payment_update: async (transaction, actionParams) => {
    const success = simulateOutcome(transaction.transactionId, 'request_payment_update', transaction.attemptCount);
    return {
      success,
      message: success
        ? 'Payment update request sent. Customer updated payment method successfully.'
        : 'Payment update request sent. Customer has not updated payment method yet.',
      simulatedOutcome: success ? 'Customer updated card details' : 'Customer did not respond to update request',
      newStatus: success ? TRANSACTION_STATUS.SUCCESS : TRANSACTION_STATUS.FAILED
    };
  },

  send_notification: async (transaction, actionParams) => {
    const success = simulateOutcome(transaction.transactionId, 'send_notification', transaction.attemptCount);
    return {
      success,
      message: success
        ? 'Recovery notification sent. Customer completed the payment.'
        : 'Recovery notification sent. Customer did not respond.',
      simulatedOutcome: success ? 'Customer completed payment after notification' : 'No customer response to notification',
      newStatus: success ? TRANSACTION_STATUS.SUCCESS : TRANSACTION_STATUS.FAILED
    };
  },

  escalate: async (transaction, actionParams) => {
    return {
      success: false, // Escalation doesn't "succeed" — it moves to manual
      message: 'Case escalated to manual review team.',
      simulatedOutcome: 'Case moved to manual intervention queue',
      newStatus: TRANSACTION_STATUS.FAILED
    };
  },

  stop_retry: async (transaction, actionParams) => {
    return {
      success: false,
      message: 'Retries stopped. Maximum retry limit reached.',
      simulatedOutcome: 'No more automatic retries',
      newStatus: TRANSACTION_STATUS.FAILED
    };
  },

  do_not_retry: async (transaction, actionParams) => {
    return {
      success: false,
      message: 'Transaction marked as non-retriable.',
      simulatedOutcome: 'Permanent failure — no recovery possible',
      newStatus: TRANSACTION_STATUS.FAILED
    };
  },

  manual_review: async (transaction, actionParams) => {
    return {
      success: false,
      message: 'Case sent for manual review.',
      simulatedOutcome: 'Awaiting manual analyst review',
      newStatus: TRANSACTION_STATUS.FAILED
    };
  }
};

// ─── Real PPS Retry Handler ─────────────────────────────────────────────────

/**
 * Execute a real payment retry through the Payment Processing System.
 * 
 * @param {Object} transaction - Transaction document
 * @param {Object} actionParams - Action parameters
 * @param {Object} recoveryCase - Recovery case document
 * @returns {Promise<Object>} Result in the same format as simulated handlers
 */
const handleRealRetry = async (transaction, actionParams, recoveryCase) => {
  if (!transaction.orderId) {
    logger.error('Cannot retry payment: missing orderId', {
      transactionId: transaction.transactionId
    });
    return {
      success: false,
      message: 'Cannot retry payment: no orderId associated with this transaction',
      simulatedOutcome: null,
      newStatus: TRANSACTION_STATUS.FAILED,
      permanent: true
    };
  }

  // Use case's actionId as recoveryActionId for idempotency at PPS
  const recoveryActionId = recoveryCase
    ? `${recoveryCase.caseId}-retry-${(recoveryCase.retryCount || 0) + 1}`
    : `${transaction.transactionId}-retry-${transaction.attemptCount}`;

  // Audit: retry requested
  await auditService.createLog({
    eventType: AUDIT_EVENTS.RECOVERY_RETRY_REQUESTED,
    transactionId: transaction.transactionId,
    caseId: recoveryCase?.caseId || null,
    action: 'retry_payment',
    reason: `Real payment retry requested via Payment Processing System`,
    metadata: {
      orderId: transaction.orderId,
      recoveryActionId,
      source: TRANSACTION_SOURCES.PAYMENT_PROCESSING_SYSTEM
    }
  });

  // Call PPS
  const ppsResult = await paymentClient.retryPayment({
    orderId: transaction.orderId,
    recoveryActionId,
    method: transaction.paymentMethod
  });

  if (ppsResult.success) {
    const paymentData = ppsResult.data?.payment || {};
    const orderData = ppsResult.data?.order || {};
    const recoveredAmount = paymentData.amount || transaction.amount;

    // Audit: retry succeeded
    await auditService.createLog({
      eventType: AUDIT_EVENTS.RECOVERY_RETRY_SUCCEEDED,
      transactionId: transaction.transactionId,
      caseId: recoveryCase?.caseId || null,
      action: 'retry_payment',
      reason: `Payment retry succeeded via PPS. Amount: ${recoveredAmount}`,
      previousState: TRANSACTION_STATUS.FAILED,
      newState: TRANSACTION_STATUS.SUCCESS,
      metadata: {
        paymentId: paymentData.paymentId,
        orderId: transaction.orderId,
        amount: recoveredAmount,
        paymentStatus: paymentData.status,
        orderStatus: orderData.status,
        remainingAttempts: orderData.remainingAttempts,
        idempotencyHit: ppsResult.idempotencyHit
      }
    });

    return {
      success: true,
      message: `Payment retry successful via Payment Processing System. Amount recovered: ${recoveredAmount}`,
      simulatedOutcome: null,
      newStatus: TRANSACTION_STATUS.SUCCESS,
      recoveredAmount,
      ppsData: ppsResult.data
    };
  }

  // Failure
  const paymentData = ppsResult.data?.payment || {};
  const orderData = ppsResult.data?.order || {};
  const failureReason = paymentData.failureReason || ppsResult.error || 'Unknown PPS error';

  // Determine if this is a permanent rejection
  const isPermanent = ppsResult.permanent === true;

  // Audit: retry failed or rejected
  const auditEventType = isPermanent
    ? AUDIT_EVENTS.RECOVERY_RETRY_REJECTED
    : AUDIT_EVENTS.RECOVERY_RETRY_FAILED;

  await auditService.createLog({
    eventType: auditEventType,
    transactionId: transaction.transactionId,
    caseId: recoveryCase?.caseId || null,
    action: 'retry_payment',
    reason: `Payment retry ${isPermanent ? 'permanently rejected' : 'failed'}: ${failureReason}`,
    metadata: {
      orderId: transaction.orderId,
      httpStatus: ppsResult.httpStatus,
      failureReason,
      permanent: isPermanent,
      paymentStatus: paymentData.status,
      orderStatus: orderData.status,
      remainingAttempts: orderData.remainingAttempts,
      retryCount: paymentData.retryCount
    }
  });

  return {
    success: false,
    message: `Payment retry failed: ${failureReason}`,
    simulatedOutcome: null,
    newStatus: TRANSACTION_STATUS.FAILED,
    permanent: isPermanent,
    ppsData: ppsResult.data,
    failureReason
  };
};

// ─── Main Executor ──────────────────────────────────────────────────────────

/**
 * Execute a recovery action for a case.
 * 
 * @param {Object} params
 * @param {Object} params.recoveryCase - Recovery case document
 * @param {Object} params.transaction - Transaction document
 * @returns {Promise<{ actionDoc: Object, result: Object }>}
 */
const executeAction = async ({ recoveryCase, transaction }) => {
  const action = recoveryCase.recommendedAction;
  const actionParams = recoveryCase.actionParams;

  // ── Idempotency check ─────────────────────────────────────────────────
  const idempotencyKey = generateIdempotencyKey(
    recoveryCase.caseId,
    action,
    recoveryCase.retryCount + 1
  );

  const existingAction = await RecoveryAction.findOne({ idempotencyKey });
  if (existingAction) {
    logger.warn('Duplicate action prevented by idempotency', {
      idempotencyKey,
      existingActionId: existingAction.actionId
    });
    return {
      duplicate: true,
      actionDoc: existingAction,
      result: existingAction.result
    };
  }

  // ── Check handler exists ──────────────────────────────────────────────
  const handler = actionHandlers[action];
  if (!handler) {
    logger.error('No handler for action', { action });
    throw new Error(`Unsupported action: ${action}`);
  }

  // ── Create action record (pending) ────────────────────────────────────
  const actionDoc = await RecoveryAction.create({
    actionId: generateId('RA'),
    caseId: recoveryCase.caseId,
    transactionId: transaction.transactionId,
    action,
    status: ACTION_STATUS.EXECUTING,
    previousState: transaction.status,
    newState: null,
    executedAt: new Date(),
    result: { success: null, message: null, simulatedOutcome: null },
    idempotencyKey
  });

  // ── Execute the action ────────────────────────────────────────────────
  try {
    const result = await handler(transaction, actionParams, recoveryCase);

    // Update action with result
    actionDoc.status = result.success ? ACTION_STATUS.SUCCESS : ACTION_STATUS.FAILED;
    actionDoc.newState = result.newStatus;
    actionDoc.result = {
      success: result.success,
      message: result.message,
      simulatedOutcome: result.simulatedOutcome
    };
    await actionDoc.save();

    // Update transaction status
    const txnUpdate = {
      attemptCount: transaction.attemptCount + 1,
      lastAttemptAt: new Date()
    };

    if (result.success) {
      txnUpdate.status = result.newStatus;
    }

    // If PPS provided remaining attempts data, update transaction
    if (result.ppsData?.order) {
      const orderData = result.ppsData.order;
      if (orderData.remainingAttempts !== undefined) {
        txnUpdate.remainingAttempts = orderData.remainingAttempts;
      }
      if (orderData.attempts !== undefined) {
        txnUpdate.attemptCount = orderData.attempts;
      }
    }

    await Transaction.updateOne(
      { transactionId: transaction.transactionId },
      txnUpdate
    );

    logger.info('Action executed', {
      actionId: actionDoc.actionId,
      action,
      success: result.success,
      transactionId: transaction.transactionId,
      source: transaction.source || 'seed'
    });

    return { duplicate: false, actionDoc, result };

  } catch (error) {
    actionDoc.status = ACTION_STATUS.FAILED;
    actionDoc.result = {
      success: false,
      message: `Execution error: ${error.message}`,
      simulatedOutcome: 'Action failed due to system error'
    };
    await actionDoc.save();

    logger.error('Action execution failed', {
      actionId: actionDoc.actionId,
      error: error.message
    });

    return {
      duplicate: false,
      actionDoc,
      result: { success: false, message: error.message }
    };
  }
};

module.exports = { executeAction, simulateOutcome };

