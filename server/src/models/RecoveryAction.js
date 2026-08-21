const mongoose = require('mongoose');

const recoveryActionSchema = new mongoose.Schema({
  actionId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  caseId: {
    type: String,
    required: true,
    index: true
  },
  transactionId: {
    type: String,
    required: true,
    index: true
  },
  action: {
    type: String,
    required: true,
    enum: [
      'retry_payment',
      'schedule_retry',
      'request_payment_update',
      'send_notification',
      'escalate',
      'stop_retry',
      'do_not_retry',
      'manual_review'
    ]
  },
  status: {
    type: String,
    required: true,
    enum: ['pending', 'executing', 'success', 'failed'],
    default: 'pending'
  },
  previousState: {
    type: String,
    required: true
  },
  newState: {
    type: String,
    default: null
  },
  executedAt: {
    type: Date,
    default: null
  },
  result: {
    success: { type: Boolean, default: null },
    message: { type: String, default: null },
    simulatedOutcome: { type: String, default: null }
  },
  idempotencyKey: {
    type: String,
    required: true,
    unique: true,
    index: true
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('RecoveryAction', recoveryActionSchema);
