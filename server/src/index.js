const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const dotenv = require('dotenv');
const path = require('path');
const { connectDatabase } = require('./config/database');
const { logger } = require('./utils/logger');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// ─── Middleware ──────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// ─── Routes ─────────────────────────────────────────────────────────────────
const healthRoutes = require('./routes/healthRoutes');
const transactionRoutes = require('./routes/transactionRoutes');
const recoveryRoutes = require('./routes/recoveryRoutes');
const metricsRoutes = require('./routes/metricsRoutes');
const auditRoutes = require('./routes/auditRoutes');

app.use('/api/health', healthRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/recovery', recoveryRoutes);
app.use('/api/metrics', metricsRoutes);
app.use('/api/audit', auditRoutes);

// ─── Serve Frontend (Production) ────────────────────────────────────────────
if (process.env.NODE_ENV === 'production' || process.env.RENDER) {
  // Serve static files from the React build directory
  const buildPath = path.join(__dirname, '../../client/dist');
  app.use(express.static(buildPath));

  // Catch-all route to serve index.html for client-side routing
  app.get('*', (req, res) => {
    res.sendFile(path.join(buildPath, 'index.html'));
  });
} else {
  // Root endpoint for development
  app.get('/', (req, res) => {
    res.json({
      success: true,
      message: 'AI Revenue Recovery Agent API',
      version: '1.0.0',
      endpoints: {
        health: 'GET /api/health',
        seed: 'POST /api/transactions/seed',
        transactions: 'GET /api/transactions',
        analyze: 'POST /api/recovery/analyze',
        executeAll: 'POST /api/recovery/execute-all',
        cases: 'GET /api/recovery/cases',
        metrics: 'GET /api/metrics/summary',
        breakdown: 'GET /api/metrics/breakdown',
        audit: 'GET /api/audit'
      }
    });
  });
}

// ─── Error Handling ─────────────────────────────────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

// ─── Start Server ───────────────────────────────────────────────────────────
const startServer = async () => {
  try {
    await connectDatabase();
    app.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`, {
        environment: process.env.NODE_ENV,
        aiMode: process.env.USE_MOCK_AI !== 'false' ? 'mock' : 'real'
      });
    });
  } catch (error) {
    logger.error('Failed to start server:', error.message);
    process.exit(1);
  }
};

startServer();

module.exports = app;
