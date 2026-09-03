const crypto = require('crypto');
const { logger } = require('../utils/logger');

/**
 * Webhook Signature Verification Middleware
 * 
 * Verifies the x-webhook-signature header using HMAC-SHA256.
 * Matches the Payment Processing System's signature generation:
 *   crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex')
 * 
 * Security:
 * - Uses crypto.timingSafeEqual for constant-time comparison (prevents timing attacks)
 * - Never logs the webhook secret
 * - Rejects requests without a signature
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
    // Compute expected signature using the same method as PPS
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(JSON.stringify(req.body))
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

    // Signature valid
    next();
  } catch (error) {
    logger.error('Webhook signature verification error', {
      error: error.message
    });
    return res.status(401).json({
      success: false,
      error: 'Webhook signature verification failed'
    });
  }
};

module.exports = { verifyWebhookSignature };
