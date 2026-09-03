const { logger } = require('../utils/logger');

const getTimeoutMs = () => {
  const value = Number(process.env.PPS_REQUEST_TIMEOUT_MS || 15000);
  return Number.isFinite(value) && value > 0 ? value : 15000;
};

const buildRetryUrl = (baseUrl) => {
  const parsed = new URL(baseUrl);
  parsed.pathname = `${parsed.pathname.replace(/\/+$/, '')}/api/internal/retry-payment`;
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
};

/**
 * Payment Processing System HTTP Client.
 * Sends only safe retry metadata. PPS owns actual payment execution and state.
 */
const retryPayment = async ({ orderId, recoveryActionId, method }) => {
  const baseUrl = process.env.PAYMENT_PROCESSING_URL;
  const apiKey = process.env.INTERNAL_API_KEY;
  const timeoutMs = getTimeoutMs();

  if (!baseUrl) {
    logger.error('PAYMENT_PROCESSING_URL is not configured');
    return { success: false, error: 'Payment Processing System URL is not configured', permanent: false };
  }

  if (!apiKey) {
    logger.error('INTERNAL_API_KEY is not configured');
    return { success: false, error: 'Internal API key is not configured', permanent: false };
  }

  let url;
  try {
    url = buildRetryUrl(baseUrl);
  } catch (error) {
    logger.error('PAYMENT_PROCESSING_URL is invalid', { error: error.message });
    return { success: false, error: 'Payment Processing System URL is invalid', permanent: true };
  }

  const body = { orderId, recoveryActionId };
  if (method) body.method = method;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    logger.info('Calling Payment Processing System for retry', { orderId, recoveryActionId });

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

    let responseData;
    try {
      responseData = await response.json();
    } catch (parseError) {
      logger.error('Failed to parse PPS response', { httpStatus: response.status, orderId });
      return {
        success: false,
        error: `Payment System returned unparseable response (HTTP ${response.status})`,
        httpStatus: response.status,
        permanent: false
      };
    }

    if (response.ok || response.status === 402) {
      const paymentStatus = responseData.data?.payment?.status;
      const orderStatus = responseData.data?.order?.status;
      const isSuccess = responseData.success === true && paymentStatus === 'success' && orderStatus === 'paid';

      logger.info('PPS retry response received', {
        orderId,
        recoveryActionId,
        success: isSuccess,
        httpStatus: response.status,
        paymentStatus,
        orderStatus,
        idempotencyHit: responseData.idempotencyHit || false
      });

      return {
        success: isSuccess,
        data: responseData.data,
        source: responseData.source || 'internal_recovery',
        idempotencyHit: responseData.idempotencyHit || false,
        httpStatus: response.status,
        permanent: false,
        error: isSuccess ? null : (responseData.message || responseData.error || 'Payment retry did not succeed')
      };
    }

    switch (response.status) {
      case 401:
      case 403:
        logger.error('PPS authentication failed', { httpStatus: response.status, orderId });
        return { success: false, error: 'Authentication failed with Payment Processing System', httpStatus: response.status, permanent: true };
      case 404:
        logger.warn('PPS order not found', { httpStatus: response.status, orderId });
        return { success: false, error: responseData.message || 'Order not found in Payment Processing System', httpStatus: response.status, permanent: true };
      case 409:
        logger.info('PPS rejected retry due to order state conflict', { httpStatus: response.status, orderId });
        return { success: false, error: responseData.message || 'Order is in a conflicting state', httpStatus: response.status, permanent: true };
      case 410:
        logger.info('PPS order expired or gone', { httpStatus: response.status, orderId });
        return { success: false, error: responseData.message || 'Order has expired', httpStatus: response.status, permanent: true };
      case 422:
        logger.warn('PPS validation error', { httpStatus: response.status, orderId, message: responseData.message });
        return { success: false, error: responseData.message || 'Payment Processing System rejected the retry request', httpStatus: response.status, permanent: true };
      case 429:
        logger.warn('PPS rate limited', { httpStatus: response.status, orderId });
        return { success: false, error: 'Rate limited by Payment Processing System', httpStatus: response.status, permanent: false };
      default:
        logger.error('PPS unexpected error', { httpStatus: response.status, orderId, message: responseData.message });
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
      logger.error('PPS request timed out', { orderId, recoveryActionId, timeoutMs });
      return { success: false, error: `Payment Processing System request timed out (${timeoutMs}ms)`, permanent: false };
    }

    logger.error('PPS network error', { orderId, recoveryActionId, error: error.message });
    return { success: false, error: `Payment Processing System unavailable: ${error.message}`, permanent: false };
  }
};

module.exports = { retryPayment };