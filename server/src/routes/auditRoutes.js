const express = require('express');
const router = express.Router();
const auditService = require('../services/auditService');

/**
 * GET /api/audit
 * List audit logs with optional filters.
 */
router.get('/', async (req, res, next) => {
  try {
    const { eventType, transactionId, page, limit } = req.query;
    const result = await auditService.getLogs({
      eventType,
      transactionId,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 50
    });
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/audit/:transactionId
 * Get full audit trail for a specific transaction.
 */
router.get('/:transactionId', async (req, res, next) => {
  try {
    const data = await auditService.getTrailByTransaction(req.params.transactionId);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
