const crypto = require('crypto');
const { logger } = require('../utils/logger');

/**
 * Verifies PPS payment.failed webhooks with HMAC-SHA256.
 * WEBHOOK_SECRET is backend-only and must match the secret PPS uses for
 * RECOVERY_WEBHOOK_SECRET when sending to this service.
 */
const verifyWebhookSignature = (req, res, next) => {
  const signature = req.headers['x-webhook-signature'];

  if (!signature) {
    logger.warn('Webhook request received without signature', {
      ip: req.ip,
      path: req.path
    });
    return res.status(401).json({
      success: false,
      error: 'Missing webhook signature'
    });
  }

  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) {
    logger.error('WEBHOOK_SECRET environment variable is not configured');
    return res.status(500).json({
      success: false,
      error: 'Webhook verification is not configured'
    });
  }

  try {
    const payloadStr = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body);
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(payloadStr)
      .digest('hex');

    const sigBuffer = Buffer.from(signature, 'hex');
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');

    if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
      logger.warn('Webhook signature verification failed', {
        ip: req.ip,
        path: req.path
      });
      return res.status(401).json({
        success: false,
        error: 'Invalid webhook signature'
      });
    }

    next();
  } catch (error) {
    logger.error('Webhook signature verification error', { error: error.message });
    return res.status(401).json({
      success: false,
      error: 'Webhook signature verification failed'
    });
  }
};

module.exports = { verifyWebhookSignature };