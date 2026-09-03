const { logger } = require('../utils/logger');

/**
 * Payment Processing System HTTP Client
 * 
 * Handles server-to-server communication with the Payment Processing System
 * for the internal retry-payment endpoint.
 * 
 * Security:
 * - INTERNAL_API_KEY is backend-only, never exposed to frontend
 * - Never logs API keys or secrets
 * - Uses AbortController for timeout protection
 * - Returns structured results for all error cases
 */

const TIMEOUT_MS = 15000; // 15 second timeout

/**
 * Call the Payment Processing System to retry a payment.
 * 
 * @param {Object} params
 * @param {string} params.orderId - Order ID from PPS
 * @param {string} params.recoveryActionId - Stable recovery action ID for idempotency
 * @param {string} [params.method] - Optional payment method override
 * @returns {Promise<{ success: boolean, data?: Object, error?: string, httpStatus?: number, permanent?: boolean }>}
 */
const retryPayment = async ({ orderId, recoveryActionId, method }) => {
  const baseUrl = process.env.PAYMENT_PROCESSING_URL;
  const apiKey = process.env.INTERNAL_API_KEY;

  if (!baseUrl) {
    logger.error('PAYMENT_PROCESSING_URL is not configured');
    return {
      success: false,
      error: 'Payment Processing System URL is not configured',
      permanent: false
    };
  }

  if (!apiKey) {
    logger.error('INTERNAL_API_KEY is not configured');
    return {
      success: false,
      error: 'Internal API key is not configured',
      permanent: false
    };
  }

  const url = `${baseUrl.replace(/\/+$/, '')}/api/internal/retry-payment`;

  const body = {
    orderId,
    recoveryActionId
  };
  if (method) {
    body.method = method;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    logger.info('Calling Payment Processing System for retry', {
      orderId,
      recoveryActionId,
      // Never log apiKey
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-api-key': apiKey
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    // Parse response body
    let responseData;
    try {
      responseData = await response.json();
    } catch (parseError) {
      logger.error('Failed to parse PPS response', {
        httpStatus: response.status,
        orderId
      });
      return {
        success: false,
        error: `Payment System returned unparseable response (HTTP ${response.status})`,
        httpStatus: response.status,
        permanent: false
      };
    }

    // Handle successful responses (200, 402)
    if (response.ok || response.status === 402) {
      const isSuccess = responseData.success === true;

      logger.info('PPS retry response received', {
        orderId,
        recoveryActionId,
        success: isSuccess,
        httpStatus: response.status,
        paymentStatus: responseData.data?.payment?.status,
        idempotencyHit: responseData.idempotencyHit || false
      });

      return {
        success: isSuccess,
        data: responseData.data,
        source: responseData.source || 'internal_recovery',
        idempotencyHit: responseData.idempotencyHit || false,
        httpStatus: response.status,
        permanent: false
      };
    }

    // Handle specific error codes
    switch (response.status) {
      case 401:
      case 403:
        logger.error('PPS authentication failed', {
          httpStatus: response.status,
          orderId
        });
        return {
          success: false,
          error: 'Authentication failed with Payment Processing System',
          httpStatus: response.status,
          permanent: true // Config issue, won't resolve with retry
        };

      case 404:
        logger.warn('PPS order not found', {
          httpStatus: response.status,
          orderId
        });
        return {
          success: false,
          error: responseData.message || 'Order not found in Payment Processing System',
          httpStatus: response.status,
          permanent: true
        };

      case 409:
        // Order already paid or conflicting state
        logger.info('PPS conflict — order may already be paid', {
          httpStatus: response.status,
          orderId
        });
        return {
          success: false,
          error: responseData.message || 'Order is in a conflicting state (may already be paid)',
          httpStatus: response.status,
          permanent: true
        };

      case 410:
        // Order expired
        logger.info('PPS order expired or gone', {
          httpStatus: response.status,
          orderId
        });
        return {
          success: false,
          error: responseData.message || 'Order has expired',
          httpStatus: response.status,
          permanent: true
        };

      case 422:
        // Validation error / max attempts reached
        logger.warn('PPS validation error', {
          httpStatus: response.status,
          orderId,
          message: responseData.message
        });
        return {
          success: false,
          error: responseData.message || 'Payment Processing System rejected the retry request',
          httpStatus: response.status,
          permanent: true
        };

      case 429:
        // Rate limited
        logger.warn('PPS rate limited', {
          httpStatus: response.status,
          orderId
        });
        return {
          success: false,
          error: 'Rate limited by Payment Processing System',
          httpStatus: response.status,
          permanent: false // Can retry later
        };

      default:
        // 5xx and other errors
        logger.error('PPS unexpected error', {
          httpStatus: response.status,
          orderId,
          message: responseData.message
        });
        return {
          success: false,
          error: responseData.message || `Payment Processing System error (HTTP ${response.status})`,
          httpStatus: response.status,
          permanent: response.status >= 500 ? false : true
        };
    }

  } catch (error) {
    clearTimeout(timeoutId);

    if (error.name === 'AbortError') {
      logger.error('PPS request timed out', {
        orderId,
        recoveryActionId,
        timeoutMs: TIMEOUT_MS
      });
      return {
        success: false,
        error: `Payment Processing System request timed out (${TIMEOUT_MS}ms)`,
        permanent: false
      };
    }

    // Network errors (ECONNREFUSED, DNS failure, etc.)
    logger.error('PPS network error', {
      orderId,
      recoveryActionId,
      error: error.message
    });
    return {
      success: false,
      error: `Payment Processing System unavailable: ${error.message}`,
      permanent: false
    };
  }
};

module.exports = { retryPayment };
