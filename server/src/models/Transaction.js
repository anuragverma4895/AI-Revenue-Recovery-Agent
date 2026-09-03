const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  transactionId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  // External payment ID from Payment Processing System (null for seed data)
  paymentId: {
    type: String,
    default: null,
    sparse: true,
    index: true
  },
  // Order ID from Payment Processing System
  orderId: {
    type: String,
    default: null,
    index: true
  },
  customerId: {
    type: String,
    required: true,
    index: true
  },
  // User ID from Payment Processing System
  userId: {
    type: String,
    default: null
  },
  customerEmail: {
    type: String,
    required: true
  },
  customerName: {
    type: String,
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  currency: {
    type: String,
    default: 'INR'
  },
  paymentMethod: {
    type: String,
    required: true,
    enum: ['upi', 'card', 'netbanking', 'wallet']
  },
  status: {
    type: String,
    required: true,
    enum: ['success', 'failed', 'pending', 'abandoned'],
    index: true
  },
  failureReason: {
    type: String,
    default: null
  },
  failureCode: {
    type: String,
    default: null,
    index: true
  },
  attemptCount: {
    type: Number,
    default: 1,
    min: 1
  },
  maxAttempts: {
    type: Number,
    default: 3
  },
  remainingAttempts: {
    type: Number,
    default: null
  },
  gatewayResponse: {
    type: String,
    default: null
  },
  isRecurring: {
    type: Boolean,
    default: false
  },
  subscriptionId: {
    type: String,
    default: null
  },
  merchantId: {
    type: String,
    default: 'MERCHANT-001'
  },
  lastAttemptAt: {
    type: Date,
    default: Date.now
  },
  // Distinguishes seed/demo data from real PPS integration data
  source: {
    type: String,
    enum: ['seed', 'payment_processing_system'],
    default: 'seed',
    index: true
  },
  metadata: {
    customerTotalTransactions: { type: Number, default: 0 },
    customerSuccessRate: { type: Number, default: 0 },
    daysSinceLastSuccess: { type: Number, default: 0 },
    platform: { type: String, enum: ['web', 'mobile', 'api'], default: 'web' }
  }
}, {
  timestamps: true // adds createdAt and updatedAt
});

module.exports = mongoose.model('Transaction', transactionSchema);

