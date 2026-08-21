const mongoose = require('mongoose');

const recoveryCaseSchema = new mongoose.Schema({
  caseId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  transactionId: {
    type: String,
    required: true,
    unique: true, // one case per transaction
    index: true
  },
  customerId: {
    type: String,
    required: true
  },
  status: {
    type: String,
    required: true,
    enum: ['open', 'in_progress', 'recovered', 'failed', 'escalated', 'closed'],
    default: 'open',
    index: true
  },
  riskLevel: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    required: true
  },
  amountAtRisk: {
    type: Number,
    required: true,
    min: 0
  },
  amountRecovered: {
    type: Number,
    default: 0,
    min: 0
  },
  decisionSource: {
    type: String,
    required: true,
    enum: ['rule_engine', 'ai_engine', 'fallback', 'manual'],
    index: true
  },
  ruleId: {
    type: String,
    default: null
  },
  decisionReason: {
    type: String,
    required: true
  },
  aiConfidence: {
    type: Number,
    default: null,
    min: 0,
    max: 1
  },
  aiRawResponse: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  recommendedAction: {
    type: String,
    required: true
  },
  actionParams: {
    delay_minutes: { type: Number, default: null },
    max_retries: { type: Number, default: null },
    secondary_action: { type: String, default: null },
    escalate_if_fails: { type: Boolean, default: false }
  },
  policyApproved: {
    type: Boolean,
    default: null
  },
  policyRejectionReason: {
    type: String,
    default: null
  },
  retryCount: {
    type: Number,
    default: 0
  },
  maxRetries: {
    type: Number,
    default: 3
  },
  nextRetryAt: {
    type: Date,
    default: null
  },
  resolvedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('RecoveryCase', recoveryCaseSchema);
