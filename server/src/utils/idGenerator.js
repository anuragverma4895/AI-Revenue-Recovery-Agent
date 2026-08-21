const { v4: uuidv4 } = require('uuid');

let counters = {
  transaction: 0,
  case: 0,
  action: 0,
  audit: 0
};

/**
 * Generate a prefixed sequential ID for readability in demos.
 * Falls back to UUID if counter is not available.
 */
const generateId = (prefix) => {
  const key = {
    'TXN': 'transaction',
    'RC': 'case',
    'RA': 'action',
    'AL': 'audit'
  }[prefix];

  if (key) {
    counters[key]++;
    return `${prefix}-${String(counters[key]).padStart(3, '0')}`;
  }

  return `${prefix}-${uuidv4().slice(0, 8)}`;
};

/**
 * Generate a UUID-based idempotency key.
 */
const generateIdempotencyKey = (caseId, action, attemptNumber) => {
  return `${caseId}:${action}:${attemptNumber}`;
};

/**
 * Reset counters (useful for seeding).
 */
const resetCounters = () => {
  counters = { transaction: 0, case: 0, action: 0, audit: 0 };
};

/**
 * Set counter to a specific value (useful after loading existing data).
 */
const setCounter = (type, value) => {
  const key = {
    'TXN': 'transaction',
    'RC': 'case',
    'RA': 'action',
    'AL': 'audit'
  }[type];
  if (key) counters[key] = value;
};

module.exports = { generateId, generateIdempotencyKey, resetCounters, setCounter };
