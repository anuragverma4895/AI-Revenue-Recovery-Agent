const express = require('express');
const router = express.Router();
const { verifyWebhookSignature } = require('../middleware/webhookAuth');
const integrationService = require('../services/integrationService');
const { logger } = require('../utils/logger');

/**
 * POST /api/webhooks/payment-failed
 * 
 * Receives real payment failure notifications from the Payment Processing System.
 * 
 * Security:
 * - Requires valid x-webhook-signature (HMAC-SHA256)
 * - Validates required fields
 * - Idempotent: duplicate events return 200 without creating duplicate cases
 * 
 * This endpoint is for REAL integration only.
 * Seed data uses the existing POST /api/transactions/seed flow.
 */
router.post('/payment-failed', verifyWebhookSignature, async (req, res, next) => {
  try {
    const payload = req.body;

    // ── Validate required fields ──────────────────────────────────────────
    const requiredFields = ['paymentId', 'orderId', 'amount', 'currency', 'status', 'method'];
    const missingFields = requiredFields.filter(field => !payload[field] && payload[field] !== 0);

    if (missingFields.length > 0) {
      logger.warn('Webhook payload missing required fields', {
        missingFields,
        paymentId: payload.paymentId
      });
      return res.status(400).json({
        success: false,
        error: `Missing required fields: ${missingFields.join(', ')}`
      });
    }

    // ── Validate status is a failed payment ──────────────────────────────
    if (payload.status !== 'failed') {
      logger.info('Webhook received for non-failed payment, ignoring', {
        paymentId: payload.paymentId,
        status: payload.status
      });
      return res.status(200).json({
        success: true,
        message: 'Non-failure event acknowledged',
        processed: false
      });
    }

    // ── Validate amount is positive ──────────────────────────────────────
    if (typeof payload.amount !== 'number' || payload.amount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid amount: must be a positive number'
      });
    }

    // ── Process the payment failure ──────────────────────────────────────
    const result = await integrationService.handlePaymentFailure(payload);

    if (result.duplicate) {
      return res.status(200).json({
        success: true,
        duplicate: true,
        message: 'Payment failure already processed',
        transactionId: result.transaction?.transactionId,
        caseId: result.recoveryCase?.caseId
      });
    }

    return res.status(201).json({
      success: true,
      duplicate: false,
      message: 'Payment failure received and recovery case created',
      transactionId: result.transaction?.transactionId,
      caseId: result.recoveryCase?.caseId,
      action: result.recoveryCase?.recommendedAction || null
    });

  } catch (error) {
    logger.error('Webhook processing error', {
      error: error.message,
      paymentId: req.body?.paymentId
    });
    next(error);
  }
});

module.exports = router;
