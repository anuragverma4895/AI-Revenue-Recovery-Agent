const Transaction = require('../models/Transaction');
const RecoveryCase = require('../models/RecoveryCase');
const RecoveryAction = require('../models/RecoveryAction');
const { TRANSACTION_STATUS, TRANSACTION_SOURCES } = require('../config/constants');

const sourceFilter = (source) => (source ? { source } : {});

const getSummaryForSource = async (source) => {
  const transactionFilter = sourceFilter(source);
  const caseFilter = sourceFilter(source);

  const totalTransactions = await Transaction.countDocuments(transactionFilter);
  const successfulTransactions = await Transaction.countDocuments({ ...transactionFilter, status: TRANSACTION_STATUS.SUCCESS });
  const failedTransactions = await Transaction.countDocuments({ ...transactionFilter, status: TRANSACTION_STATUS.FAILED });
  const pendingTransactions = await Transaction.countDocuments({ ...transactionFilter, status: TRANSACTION_STATUS.PENDING });
  const abandonedTransactions = await Transaction.countDocuments({ ...transactionFilter, status: TRANSACTION_STATUS.ABANDONED });
  const atRiskTransactions = failedTransactions + pendingTransactions + abandonedTransactions;

  const revenueAtRiskResult = await Transaction.aggregate([
    { $match: { ...transactionFilter, status: { $in: ['failed', 'pending', 'abandoned'] } } },
    { $group: { _id: null, total: { $sum: '$amount' } } }
  ]);
  const totalRevenueAtRisk = revenueAtRiskResult[0]?.total || 0;

  const revenueRecoveredResult = await RecoveryCase.aggregate([
    { $match: { ...caseFilter, status: 'recovered' } },
    { $group: { _id: null, total: { $sum: '$amountRecovered' } } }
  ]);
  const totalRevenueRecovered = revenueRecoveredResult[0]?.total || 0;

  const recoveryRate = totalRevenueAtRisk > 0
    ? parseFloat(((totalRevenueRecovered / totalRevenueAtRisk) * 100).toFixed(2))
    : 0;

  const caseIds = source ? await RecoveryCase.find(caseFilter).distinct('caseId') : null;
  const actionFilter = caseIds ? { caseId: { $in: caseIds } } : {};
  const totalRecoveryAttempts = await RecoveryAction.countDocuments({ ...actionFilter, status: { $in: ['success', 'failed'] } });
  const successfulRecoveries = await RecoveryAction.countDocuments({ ...actionFilter, status: 'success' });
  const failedRecoveries = await RecoveryAction.countDocuments({ ...actionFilter, status: 'failed' });
  const pendingRecoveries = await RecoveryCase.countDocuments({ ...caseFilter, status: { $in: ['open', 'in_progress'] } });

  const successfulRecoveryRate = totalRecoveryAttempts > 0
    ? parseFloat(((successfulRecoveries / totalRecoveryAttempts) * 100).toFixed(2))
    : 0;

  const averageRecoveryAmount = successfulRecoveries > 0
    ? parseFloat((totalRevenueRecovered / successfulRecoveries).toFixed(2))
    : 0;

  const manualEscalations = await RecoveryCase.countDocuments({ ...caseFilter, status: 'escalated' });

  return {
    source: source || 'all',
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

const getSummary = async ({ source } = {}) => {
  const summary = await getSummaryForSource(source);

  if (!source) {
    summary.bySource = {
      seed: await getSummaryForSource(TRANSACTION_SOURCES.SEED),
      payment_processing_system: await getSummaryForSource(TRANSACTION_SOURCES.PAYMENT_PROCESSING_SYSTEM)
    };
  }

  return summary;
};

const getBreakdown = async ({ source } = {}) => {
  const caseFilter = sourceFilter(source);

  const byDecisionSource = await RecoveryCase.aggregate([
    { $match: caseFilter },
    {
      $group: {
        _id: '$decisionSource',
        count: { $sum: 1 },
        recovered: { $sum: { $cond: [{ $eq: ['$status', 'recovered'] }, '$amountRecovered', 0] } },
        failed: { $sum: { $cond: [{ $in: ['$status', ['failed', 'escalated']] }, 1, 0] } }
      }
    }
  ]);

  const decisionSourceMap = {};
  byDecisionSource.forEach(item => {
    decisionSourceMap[item._id] = { count: item.count, recovered: item.recovered, failed: item.failed };
  });

  const caseIds = source ? await RecoveryCase.find(caseFilter).distinct('caseId') : null;
  const actionMatch = caseIds ? { caseId: { $in: caseIds } } : {};
  const byAction = await RecoveryAction.aggregate([
    { $match: actionMatch },
    {
      $group: {
        _id: '$action',
        count: { $sum: 1 },
        successCount: { $sum: { $cond: [{ $eq: ['$status', 'success'] }, 1, 0] } },
        failCount: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } }
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

  const byRiskLevel = await RecoveryCase.aggregate([
    { $match: caseFilter },
    { $group: { _id: '$riskLevel', count: { $sum: 1 } } }
  ]);

  const riskLevelMap = {};
  byRiskLevel.forEach(item => { riskLevelMap[item._id] = item.count; });

  return { source: source || 'all', byDecisionSource: decisionSourceMap, byAction: actionMap, byRiskLevel: riskLevelMap };
};

module.exports = { getSummary, getBreakdown };