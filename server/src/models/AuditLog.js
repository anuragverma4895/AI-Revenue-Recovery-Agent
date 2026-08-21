const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  logId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  eventType: {
    type: String,
    required: true,
    enum: [
      'risk_detected',
      'rule_applied',
      'ai_invoked',
      'ai_fallback',
      'policy_approved',
      'policy_rejected',
      'action_executed',
      'action_failed',
      'case_resolved',
      'case_escalated',
      'system_error'
    ],
    index: true
  },
  transactionId: {
    type: String,
    required: true,
    index: true
  },
  caseId: {
    type: String,
    default: null
  },
  actionId: {
    type: String,
    default: null
  },
  decisionSource: {
    type: String,
    enum: ['rule_engine', 'ai_engine', 'fallback', 'manual', null],
    default: null
  },
  ruleId: {
    type: String,
    default: null
  },
  action: {
    type: String,
    default: null
  },
  reason: {
    type: String,
    required: true
  },
  confidence: {
    type: Number,
    default: null
  },
  previousState: {
    type: String,
    default: null
  },
  newState: {
    type: String,
    default: null
  },
  policyApproved: {
    type: Boolean,
    default: null
  },
  policyRejectionReason: {
    type: String,
    default: null
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  }
});

// Compound index for efficient queries
auditLogSchema.index({ transactionId: 1, timestamp: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
