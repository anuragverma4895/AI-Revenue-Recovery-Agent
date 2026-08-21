const { POLICY } = require('../config/constants');
const { logger } = require('../utils/logger');

/**
 * Retry Manager
 * 
 * Manages retry scheduling with bounds and backoff.
 * In a production system, this would integrate with a job queue (Bull, etc).
 * For the demo, retry scheduling is simulated.
 */

/**
 * Calculate the next retry time based on backoff strategy.
 * @param {number} retryCount - Current retry count
 * @param {number} baseDelayMinutes - Base delay in minutes
 * @returns {Date} Next retry timestamp
 */
const calculateNextRetry = (retryCount, baseDelayMinutes = 15) => {
  // Exponential backoff: delay * 2^retryCount, capped at max
  const backoffMultiplier = Math.pow(2, retryCount);
  let delayMinutes = baseDelayMinutes * backoffMultiplier;

  // Clamp to policy bounds
  delayMinutes = Math.max(delayMinutes, POLICY.minRetryDelayMinutes);
  delayMinutes = Math.min(delayMinutes, POLICY.maxRetryDelayMinutes);

  const nextRetryAt = new Date(Date.now() + delayMinutes * 60 * 1000);

  logger.debug('Retry scheduled', {
    retryCount,
    baseDelayMinutes,
    actualDelayMinutes: delayMinutes,
    nextRetryAt: nextRetryAt.toISOString()
  });

  return nextRetryAt;
};

/**
 * Check if a case is eligible for retry.
 * @param {Object} recoveryCase - Recovery case document
 * @returns {{ eligible: boolean, reason: string }}
 */
const canRetry = (recoveryCase) => {
  if (recoveryCase.retryCount >= POLICY.maxTotalRetries) {
    return {
      eligible: false,
      reason: `Retry limit exceeded (${recoveryCase.retryCount}/${POLICY.maxTotalRetries})`
    };
  }

  if (['recovered', 'closed'].includes(recoveryCase.status)) {
    return {
      eligible: false,
      reason: `Case is already ${recoveryCase.status}`
    };
  }

  return {
    eligible: true,
    reason: `Retry ${recoveryCase.retryCount + 1}/${POLICY.maxTotalRetries} available`
  };
};

/**
 * Get retry info for a case.
 */
const getRetryInfo = (recoveryCase) => {
  const eligibility = canRetry(recoveryCase);

  return {
    currentRetries: recoveryCase.retryCount,
    maxRetries: POLICY.maxTotalRetries,
    retriesRemaining: Math.max(0, POLICY.maxTotalRetries - recoveryCase.retryCount),
    eligible: eligibility.eligible,
    reason: eligibility.reason,
    nextRetryAt: recoveryCase.nextRetryAt
  };
};

module.exports = { calculateNextRetry, canRetry, getRetryInfo };
