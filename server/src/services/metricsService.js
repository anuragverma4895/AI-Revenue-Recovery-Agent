const Transaction = require('../models/Transaction');
const RecoveryCase = require('../models/RecoveryCase');
const RecoveryAction = require('../models/RecoveryAction');
const { TRANSACTION_STATUS } = require('../config/constants');
const { logger } = require('../utils/logger');

/**
 * Metrics Service
 * 
 * Computes all metrics from actual database data using MongoDB aggregation.
 * No hardcoded or fake metrics — everything is calculated from real state.
 */

/**
 * Get summary metrics.
 */
const getSummary = async () => {
  // Transaction counts
  const totalTransactions = await Transaction.countDocuments();
  const successfulTransactions = await Transaction.countDocuments({ status: TRANSACTION_STATUS.SUCCESS });
  const failedTransactions = await Transaction.countDocuments({ status: TRANSACTION_STATUS.FAILED });
  const pendingTransactions = await Transaction.countDocuments({ status: TRANSACTION_STATUS.PENDING });
  const abandonedTransactions = await Transaction.countDocuments({ status: TRANSACTION_STATUS.ABANDONED });
  const atRiskTransactions = failedTransactions + pendingTransactions + abandonedTransactions;

  // Revenue calculations
  const revenueAtRiskResult = await Transaction.aggregate([
    { $match: { status: { $in: ['failed', 'pending', 'abandoned'] } } },
    { $group: { _id: null, total: { $sum: '$amount' } } }
  ]);
  const totalRevenueAtRisk = revenueAtRiskResult[0]?.total || 0;

  const revenueRecoveredResult = await RecoveryCase.aggregate([
    { $match: { status: 'recovered' } },
    { $group: { _id: null, total: { $sum: '$amountRecovered' } } }
  ]);
  const totalRevenueRecovered = revenueRecoveredResult[0]?.total || 0;

  const recoveryRate = totalRevenueAtRisk > 0
    ? parseFloat(((totalRevenueRecovered / totalRevenueAtRisk) * 100).toFixed(2))
    : 0;

  // Recovery attempt counts
  const totalRecoveryAttempts = await RecoveryAction.countDocuments({
    status: { $in: ['success', 'failed'] }
  });
  const successfulRecoveries = await RecoveryAction.countDocuments({ status: 'success' });
  const failedRecoveries = await RecoveryAction.countDocuments({ status: 'failed' });
  const pendingRecoveries = await RecoveryCase.countDocuments({
    status: { $in: ['open', 'in_progress'] }
  });

  const successfulRecoveryRate = totalRecoveryAttempts > 0
    ? parseFloat(((successfulRecoveries / totalRecoveryAttempts) * 100).toFixed(2))
    : 0;

  const averageRecoveryAmount = successfulRecoveries > 0
    ? parseFloat((totalRevenueRecovered / successfulRecoveries).toFixed(2))
    : 0;

  // Escalations
  const manualEscalations = await RecoveryCase.countDocuments({ status: 'escalated' });

  return {
    totalTransactions,
    successfulTransactions,
    failedTransactions,
    pendingTransactions,
    abandonedTransactions,
    atRiskTransactions,
    totalRevenueAtRisk,
    totalRevenueRecovered,
    recoveryRate,
    totalRecoveryAttempts,
    successfulRecoveries,
    failedRecoveries,
    pendingRecoveries,
    successfulRecoveryRate,
    averageRecoveryAmount,
    manualEscalations
  };
};

/**
 * Get breakdown by decision source, action type, and risk level.
 */
const getBreakdown = async () => {
  // By decision source
  const byDecisionSource = await RecoveryCase.aggregate([
    {
      $group: {
        _id: '$decisionSource',
        count: { $sum: 1 },
        recovered: {
          $sum: { $cond: [{ $eq: ['$status', 'recovered'] }, '$amountRecovered', 0] }
        },
        failed: {
          $sum: { $cond: [{ $in: ['$status', ['failed', 'escalated']] }, 1, 0] }
        }
      }
    }
  ]);

  const decisionSourceMap = {};
  byDecisionSource.forEach(item => {
    decisionSourceMap[item._id] = {
      count: item.count,
      recovered: item.recovered,
      failed: item.failed
    };
  });

  // By action type
  const byAction = await RecoveryAction.aggregate([
    {
      $group: {
        _id: '$action',
        count: { $sum: 1 },
        successCount: {
          $sum: { $cond: [{ $eq: ['$status', 'success'] }, 1, 0] }
        },
        failCount: {
          $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] }
        }
      }
    }
  ]);

  const actionMap = {};
  byAction.forEach(item => {
    const total = item.successCount + item.failCount;
    actionMap[item._id] = {
      count: item.count,
      successCount: item.successCount,
      failCount: item.failCount,
      successRate: total > 0 ? parseFloat(((item.successCount / total) * 100).toFixed(1)) : 0
    };
  });

  // By risk level
  const byRiskLevel = await RecoveryCase.aggregate([
    { $group: { _id: '$riskLevel', count: { $sum: 1 } } }
  ]);

  const riskLevelMap = {};
  byRiskLevel.forEach(item => {
    riskLevelMap[item._id] = item.count;
  });

  return {
    byDecisionSource: decisionSourceMap,
    byAction: actionMap,
    byRiskLevel: riskLevelMap
  };
};

module.exports = { getSummary, getBreakdown };
