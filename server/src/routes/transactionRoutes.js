const express = require('express');
const router = express.Router();
const Transaction = require('../models/Transaction');
const RecoveryCase = require('../models/RecoveryCase');
const RecoveryAction = require('../models/RecoveryAction');
const AuditLog = require('../models/AuditLog');
const { seedTransactions } = require('../data/seedTransactions');
const { resetCounters } = require('../utils/idGenerator');
const { logger } = require('../utils/logger');

/**
 * POST /api/transactions/seed
 * Seed the database with synthetic transactions.
 * Idempotent — clears existing data first.
 */
router.post('/seed', async (req, res, next) => {
  try {
    // Clear all collections
    await Transaction.deleteMany({});
    await RecoveryCase.deleteMany({});
    await RecoveryAction.deleteMany({});
    await AuditLog.deleteMany({});
    resetCounters();

    // Insert seed data
    await Transaction.insertMany(seedTransactions);

    // Count by status
    const counts = {
      total: seedTransactions.length,
      success: seedTransactions.filter(t => t.status === 'success').length,
      failed: seedTransactions.filter(t => t.status === 'failed').length,
      pending: seedTransactions.filter(t => t.status === 'pending').length,
      abandoned: seedTransactions.filter(t => t.status === 'abandoned').length
    };

    logger.info('Database seeded', counts);

    res.json({
      success: true,
      message: `Seeded ${counts.total} transactions`,
      counts
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/transactions
 * List transactions with optional filters and pagination.
 */
router.get('/', async (req, res, next) => {
  try {
    const { status, paymentMethod, search, page = 1, limit = 20 } = req.query;

    const filter = {};
    if (status) filter.status = status;
    if (paymentMethod) filter.paymentMethod = paymentMethod;
    if (search) {
      filter.$or = [
        { transactionId: { $regex: search, $options: 'i' } },
        { customerId: { $regex: search, $options: 'i' } },
        { customerName: { $regex: search, $options: 'i' } }
      ];
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const total = await Transaction.countDocuments(filter);
    const data = await Transaction.find(filter)
      .sort({ createdAt: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .lean();

    res.json({
      success: true,
      data,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/transactions/:transactionId
 * Get a single transaction by ID.
 */
router.get('/:transactionId', async (req, res, next) => {
  try {
    const transaction = await Transaction.findOne({
      transactionId: req.params.transactionId
    }).lean();

    if (!transaction) {
      return res.status(404).json({
        success: false,
        error: 'Transaction not found'
      });
    }

    res.json({ success: true, data: transaction });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
