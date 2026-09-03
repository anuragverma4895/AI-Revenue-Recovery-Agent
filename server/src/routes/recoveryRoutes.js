const express = require('express');
const router = express.Router();
const recoveryService = require('../services/recoveryService');
const { logger } = require('../utils/logger');

/**
 * POST /api/recovery/analyze
 * Analyze all at-risk transactions and create recovery cases.
 */
router.post('/analyze', async (req, res, next) => {
  try {
    const summary = await recoveryService.analyzeAll();
    res.json({
      success: true,
      message: 'Analysis complete',
      summary
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/recovery/execute/:caseId
 * Execute recovery for a specific case.
 */
router.post('/execute/:caseId', async (req, res, next) => {
  try {
    const result = await recoveryService.executeCase(req.params.caseId);

    if (result.actionStatus === 'duplicate') {
      return res.json({
        success: true,
        duplicate: true,
        message: 'Action already executed; returning existing result',
        existingAction: result.existingAction
      });
    }

    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/recovery/execute-all
 * Execute all pending recovery cases.
 */
router.post('/execute-all', async (req, res, next) => {
  try {
    const summary = await recoveryService.executeAll();
    res.json({
      success: true,
      message: 'Batch execution complete',
      summary
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/recovery/cases
 * List recovery cases with filters.
 */
router.get('/cases', async (req, res, next) => {
  try {
    const { status, decisionSource, riskLevel, source, page, limit } = req.query;
    const result = await recoveryService.getCases({
      status,
      decisionSource,
      riskLevel,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20
    });
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/recovery/cases/:caseId
 * Get full case detail with transaction, actions, and audit trail.
 */
router.get('/cases/:caseId', async (req, res, next) => {
  try {
    const detail = await recoveryService.getCaseDetail(req.params.caseId);
    if (!detail) {
      return res.status(404).json({
        success: false,
        error: 'Recovery case not found'
      });
    }
    res.json({ success: true, data: detail });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
