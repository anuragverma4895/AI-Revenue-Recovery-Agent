const express = require('express');
const router = express.Router();
const metricsService = require('../services/metricsService');
const { TRANSACTION_SOURCES } = require('../config/constants');

const parseSource = (source) => {
  if (!source) return null;
  if (!Object.values(TRANSACTION_SOURCES).includes(source)) {
    const error = new Error('Invalid source filter');
    error.statusCode = 400;
    throw error;
  }
  return source;
};

router.get('/summary', async (req, res, next) => {
  try {
    const data = await metricsService.getSummary({ source: parseSource(req.query.source) });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

router.get('/breakdown', async (req, res, next) => {
  try {
    const data = await metricsService.getBreakdown({ source: parseSource(req.query.source) });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

module.exports = router;