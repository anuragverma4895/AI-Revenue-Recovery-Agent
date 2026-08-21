const { TRANSACTION_STATUS, RISK_LEVELS } = require('../config/constants');
const { logger } = require('../utils/logger');

/**
 * Risk Detection Engine
 * 
 * Analyzes transactions to determine if revenue is at risk.
 * Returns risk assessment for each transaction.
 */

/**
 * Determine if a transaction has revenue at risk.
 * @param {Object} transaction - Transaction document
 * @returns {{ atRisk: boolean, riskLevel: string, reason: string }}
 */
const assessRisk = (transaction) => {
  // Successful transactions are not at risk
  if (transaction.status === TRANSACTION_STATUS.SUCCESS) {
    return {
      atRisk: false,
      riskLevel: null,
      reason: 'Transaction completed successfully'
    };
  }

  // Failed transactions
  if (transaction.status === TRANSACTION_STATUS.FAILED) {
    const riskLevel = calculateFailedTransactionRisk(transaction);
    return {
      atRisk: true,
      riskLevel,
      reason: `Payment failed: ${transaction.failureReason || 'Unknown reason'}`
    };
  }

  // Pending transactions
  if (transaction.status === TRANSACTION_STATUS.PENDING) {
    const hoursPending = (Date.now() - new Date(transaction.lastAttemptAt).getTime()) / (1000 * 60 * 60);
    const riskLevel = hoursPending > 24 ? RISK_LEVELS.HIGH : RISK_LEVELS.MEDIUM;
    return {
      atRisk: true,
      riskLevel,
      reason: `Payment stuck in pending state for ${Math.round(hoursPending)} hours`
    };
  }

  // Abandoned transactions
  if (transaction.status === TRANSACTION_STATUS.ABANDONED) {
    return {
      atRisk: true,
      riskLevel: RISK_LEVELS.LOW,
      reason: `Customer abandoned checkout: ${transaction.failureReason || 'Unknown reason'}`
    };
  }

  return {
    atRisk: false,
    riskLevel: null,
    reason: 'Unknown transaction status'
  };
};

/**
 * Calculate risk level for a failed transaction based on multiple factors.
 */
const calculateFailedTransactionRisk = (transaction) => {
  let riskScore = 0;

  // Factor 1: Amount (higher amount = higher risk)
  if (transaction.amount > 50000) riskScore += 3;
  else if (transaction.amount > 10000) riskScore += 2;
  else if (transaction.amount > 5000) riskScore += 1;

  // Factor 2: Recurring/subscription (losing a subscriber is high risk)
  if (transaction.isRecurring) riskScore += 2;

  // Factor 3: Customer value (high success rate = valuable customer)
  if (transaction.metadata?.customerSuccessRate > 0.8) riskScore += 2;
  else if (transaction.metadata?.customerSuccessRate > 0.5) riskScore += 1;

  // Factor 4: Retry exhaustion
  if (transaction.attemptCount >= transaction.maxAttempts) riskScore += 2;

  // Factor 5: Recency (recent failures are more actionable)
  const hoursSinceLastAttempt = (Date.now() - new Date(transaction.lastAttemptAt).getTime()) / (1000 * 60 * 60);
  if (hoursSinceLastAttempt < 6) riskScore += 1;

  // Map score to risk level
  if (riskScore >= 7) return RISK_LEVELS.CRITICAL;
  if (riskScore >= 5) return RISK_LEVELS.HIGH;
  if (riskScore >= 3) return RISK_LEVELS.MEDIUM;
  return RISK_LEVELS.LOW;
};

/**
 * Batch assess risk for multiple transactions.
 * @param {Array} transactions - Array of transaction documents
 * @returns {Array} Array of { transaction, riskAssessment }
 */
const batchAssessRisk = (transactions) => {
  const results = transactions.map(transaction => ({
    transaction,
    riskAssessment: assessRisk(transaction)
  }));

  const atRiskCount = results.filter(r => r.riskAssessment.atRisk).length;
  logger.info('Risk assessment complete', {
    total: transactions.length,
    atRisk: atRiskCount,
    safe: transactions.length - atRiskCount
  });

  return results;
};

module.exports = { assessRisk, batchAssessRisk, calculateFailedTransactionRisk };
