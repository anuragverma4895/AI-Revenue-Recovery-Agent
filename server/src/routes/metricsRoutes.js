const express = require('express');
const router = express.Router();
const metricsService = require('../services/metricsService');

/**
 * GET /api/metrics/summary
 */
router.get('/summary', async (req, res, next) => {
  try {
    const data = await metricsService.getSummary();
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/metrics/breakdown
 */
router.get('/breakdown', async (req, res, next) => {
  try {
    const data = await metricsService.getBreakdown();
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
