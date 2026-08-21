const RecoveryAction = require('../models/RecoveryAction');
const Transaction = require('../models/Transaction');
const { SIMULATED_SUCCESS_RATES, ACTION_STATUS, TRANSACTION_STATUS } = require('../config/constants');
const { generateId, generateIdempotencyKey } = require('../utils/idGenerator');
const { logger } = require('../utils/logger');

/**
 * Recovery Action Executor
 * 
 * Executes bounded recovery actions. All actions are SIMULATED for the demo.
 * Uses seeded-random based on transactionId for deterministic outcomes.
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
 */
const simulateOutcome = (transactionId, action, attemptNumber = 1) => {
  const seed = hashCode(`${transactionId}:${action}:${attemptNumber}`);
  const threshold = SIMULATED_SUCCESS_RATES[action] || 0;
  const roll = (seed % 100) / 100;
  return roll < threshold;
};

// ─── Action Handlers ────────────────────────────────────────────────────────

const actionHandlers = {
  retry_payment: async (transaction, actionParams) => {
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
    const result = await handler(transaction, actionParams);

    // Update action with result
    actionDoc.status = result.success ? ACTION_STATUS.SUCCESS : ACTION_STATUS.FAILED;
    actionDoc.newState = result.newStatus;
    actionDoc.result = {
      success: result.success,
      message: result.message,
      simulatedOutcome: result.simulatedOutcome
    };
    await actionDoc.save();

    // Update transaction status if action changed it
    if (result.success) {
      await Transaction.updateOne(
        { transactionId: transaction.transactionId },
        {
          status: result.newStatus,
          attemptCount: transaction.attemptCount + 1,
          lastAttemptAt: new Date()
        }
      );
    } else {
      await Transaction.updateOne(
        { transactionId: transaction.transactionId },
        {
          attemptCount: transaction.attemptCount + 1,
          lastAttemptAt: new Date()
        }
      );
    }

    logger.info('Action executed', {
      actionId: actionDoc.actionId,
      action,
      success: result.success,
      transactionId: transaction.transactionId
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
