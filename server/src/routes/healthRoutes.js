const express = require('express');
const router = express.Router();
const { AI_CONFIG } = require('../config/constants');
const mongoose = require('mongoose');

router.get('/', (req, res) => {
  res.json({
    success: true,
    status: 'ok',
    timestamp: new Date().toISOString(),
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    aiMode: AI_CONFIG.useMockAI ? 'mock' : 'real_gemini',
    version: '1.0.0'
  });
});

module.exports = router;
