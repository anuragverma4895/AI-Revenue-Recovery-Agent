const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  transactionId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  customerId: {
    type: String,
    required: true,
    index: true
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
