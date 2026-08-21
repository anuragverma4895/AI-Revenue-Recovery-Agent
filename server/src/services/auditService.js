const AuditLog = require('../models/AuditLog');
const { generateId } = require('../utils/idGenerator');
const { logger } = require('../utils/logger');

/**
 * Audit Service
 * 
 * Creates immutable audit log entries for every significant event.
 * Audit logs are append-only — they are never updated or deleted.
 */

/**
 * Create an audit log entry.
 * @param {Object} params - Audit log fields
 * @returns {Promise<Object>} Created audit log document
 */
const createLog = async ({
  eventType,
  transactionId,
  caseId = null,
  actionId = null,
  decisionSource = null,
  ruleId = null,
  action = null,
  reason,
  confidence = null,
  previousState = null,
  newState = null,
  policyApproved = null,
  policyRejectionReason = null,
  metadata = {}
}) => {
  try {
    const log = await AuditLog.create({
      logId: generateId('AL'),
      eventType,
      transactionId,
      caseId,
      actionId,
      decisionSource,
      ruleId,
      action,
      reason,
      confidence,
      previousState,
      newState,
      policyApproved,
      policyRejectionReason,
      metadata,
      timestamp: new Date()
    });

    logger.debug('Audit log created', {
      logId: log.logId,
      eventType,
      transactionId
    });

    return log;
  } catch (error) {
    // Audit logging should never crash the main workflow
    logger.error('Failed to create audit log', {
      eventType,
      transactionId,
      error: error.message
    });
    return null;
  }
};

/**
 * Get audit trail for a specific transaction.
 */
const getTrailByTransaction = async (transactionId) => {
  return AuditLog.find({ transactionId })
    .sort({ timestamp: 1 })
    .lean();
};

/**
 * Get audit logs with optional filters and pagination.
 */
const getLogs = async ({ eventType, transactionId, page = 1, limit = 50 } = {}) => {
  const filter = {};
  if (eventType) filter.eventType = eventType;
  if (transactionId) filter.transactionId = transactionId;

  const total = await AuditLog.countDocuments(filter);
  const data = await AuditLog.find(filter)
    .sort({ timestamp: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();

  return {
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  };
};

module.exports = { createLog, getTrailByTransaction, getLogs };
