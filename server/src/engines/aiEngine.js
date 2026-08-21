const { GoogleGenerativeAI } = require('@google/generative-ai');
const { AI_CONFIG, RECOVERY_ACTIONS, RISK_LEVELS } = require('../config/constants');
const { logger } = require('../utils/logger');

/**
 * AI Decision Engine
 * 
 * Two modes:
 * 1. Mock AI mode (USE_MOCK_AI=true) — deterministic responses for dev/testing
 * 2. Real Gemini mode (USE_MOCK_AI=false) — calls Gemini API for contextual reasoning
 * 
 * Both modes return the same structured JSON format.
 */

// ─── AI Response Schema Validation ──────────────────────────────────────────

const validateAIResponse = (response) => {
  const errors = [];

  if (!response || typeof response !== 'object') {
    return { valid: false, errors: ['Response is not a valid object'] };
  }

  // Required fields
  if (!AI_CONFIG.validRiskLevels.includes(response.risk_level)) {
    errors.push(`Invalid risk_level: "${response.risk_level}". Must be one of: ${AI_CONFIG.validRiskLevels.join(', ')}`);
  }

  if (!AI_CONFIG.validActions.includes(response.recovery_action)) {
    errors.push(`Invalid recovery_action: "${response.recovery_action}". Must be one of: ${AI_CONFIG.validActions.join(', ')}`);
  }

  if (typeof response.confidence !== 'number' || response.confidence < 0 || response.confidence > 1) {
    errors.push(`Invalid confidence: "${response.confidence}". Must be a number between 0 and 1`);
  }

  if (!response.reason || typeof response.reason !== 'string' || response.reason.trim().length === 0) {
    errors.push('Missing or empty reason field');
  }

  // Optional field validation
  if (response.delay_minutes !== null && response.delay_minutes !== undefined) {
    if (typeof response.delay_minutes !== 'number' || response.delay_minutes < 5 || response.delay_minutes > 10080) {
      errors.push(`Invalid delay_minutes: ${response.delay_minutes}. Must be between 5 and 10080`);
    }
  }

  if (response.max_retries !== null && response.max_retries !== undefined) {
    if (typeof response.max_retries !== 'number' || response.max_retries < 1 || response.max_retries > 5) {
      errors.push(`Invalid max_retries: ${response.max_retries}. Must be between 1 and 5`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
};

// ─── Build Context for AI ───────────────────────────────────────────────────

const buildAIContext = (transaction) => {
  return {
    transaction: {
      transactionId: transaction.transactionId,
      amount: transaction.amount,
      currency: transaction.currency,
      paymentMethod: transaction.paymentMethod,
      status: transaction.status,
      failureReason: transaction.failureReason,
      failureCode: transaction.failureCode,
      attemptCount: transaction.attemptCount,
      maxAttempts: transaction.maxAttempts,
      isRecurring: transaction.isRecurring,
      subscriptionId: transaction.subscriptionId
    },
    customerContext: {
      customerId: transaction.customerId,
      totalTransactions: transaction.metadata?.customerTotalTransactions || 0,
      successRate: transaction.metadata?.customerSuccessRate || 0,
      daysSinceLastSuccess: transaction.metadata?.daysSinceLastSuccess || 0,
      platform: transaction.metadata?.platform || 'unknown'
    },
    constraints: {
      maxRetries: transaction.maxAttempts - transaction.attemptCount,
      maxDelayMinutes: 10080,
      allowedActions: [
        RECOVERY_ACTIONS.RETRY_PAYMENT,
        RECOVERY_ACTIONS.SCHEDULE_RETRY,
        RECOVERY_ACTIONS.REQUEST_PAYMENT_UPDATE,
        RECOVERY_ACTIONS.SEND_NOTIFICATION,
        RECOVERY_ACTIONS.ESCALATE,
        RECOVERY_ACTIONS.MANUAL_REVIEW
      ],
      maxAutoRecoveryAmount: 100000
    }
  };
};

// ─── Mock AI Engine ─────────────────────────────────────────────────────────

const getMockDecision = (transaction) => {
  const ctx = transaction;

  // High-value transaction → escalate
  if (ctx.amount > 50000) {
    return {
      risk_level: RISK_LEVELS.CRITICAL,
      recovery_action: RECOVERY_ACTIONS.ESCALATE,
      reason: `High-value transaction (₹${ctx.amount.toLocaleString()}) requires manual oversight. The failure pattern is ambiguous and automated recovery poses financial risk.`,
      confidence: 0.65,
      delay_minutes: null,
      max_retries: null,
      secondary_action: RECOVERY_ACTIONS.SEND_NOTIFICATION,
      escalate_if_fails: true
    };
  }

  // Recurring + gateway error → high priority retry
  if (ctx.isRecurring && ctx.failureCode === 'GATEWAY_ERROR') {
    return {
      risk_level: RISK_LEVELS.HIGH,
      recovery_action: RECOVERY_ACTIONS.RETRY_PAYMENT,
      reason: `Recurring subscription payment with gateway error. Customer has ${(ctx.metadata?.customerSuccessRate * 100 || 0).toFixed(0)}% success rate. High priority retry recommended to prevent churn.`,
      confidence: 0.85,
      delay_minutes: 30,
      max_retries: 2,
      secondary_action: RECOVERY_ACTIONS.SEND_NOTIFICATION,
      escalate_if_fails: true
    };
  }

  // Gateway error (non-recurring) → schedule retry
  if (ctx.failureCode === 'GATEWAY_ERROR') {
    return {
      risk_level: RISK_LEVELS.MEDIUM,
      recovery_action: RECOVERY_ACTIONS.SCHEDULE_RETRY,
      reason: `Gateway processing error for one-time payment. Error may be transient. Scheduling retry with conservative delay.`,
      confidence: 0.72,
      delay_minutes: 60,
      max_retries: 2,
      secondary_action: null,
      escalate_if_fails: true
    };
  }

  // Low customer success rate → manual review
  if ((ctx.metadata?.customerSuccessRate || 1) < 0.3) {
    return {
      risk_level: RISK_LEVELS.HIGH,
      recovery_action: RECOVERY_ACTIONS.MANUAL_REVIEW,
      reason: `Customer has a very low success rate (${((ctx.metadata?.customerSuccessRate || 0) * 100).toFixed(0)}%). Automated recovery is risky. Manual review recommended.`,
      confidence: 0.60,
      delay_minutes: null,
      max_retries: null,
      secondary_action: null,
      escalate_if_fails: false
    };
  }

  // Processor declined → request payment update
  if (ctx.failureCode === 'PROCESSOR_DECLINED') {
    return {
      risk_level: RISK_LEVELS.MEDIUM,
      recovery_action: RECOVERY_ACTIONS.REQUEST_PAYMENT_UPDATE,
      reason: `Processor declined the transaction. This often indicates a card issue that requires customer action.`,
      confidence: 0.78,
      delay_minutes: null,
      max_retries: null,
      secondary_action: RECOVERY_ACTIONS.SEND_NOTIFICATION,
      escalate_if_fails: true
    };
  }

  // Pending for long time → send notification
  if (ctx.status === 'pending' && (ctx.metadata?.daysSinceLastSuccess || 0) > 7) {
    return {
      risk_level: RISK_LEVELS.MEDIUM,
      recovery_action: RECOVERY_ACTIONS.SEND_NOTIFICATION,
      reason: `Transaction has been pending for an extended period. Customer notification recommended to prompt action.`,
      confidence: 0.70,
      delay_minutes: null,
      max_retries: null,
      secondary_action: RECOVERY_ACTIONS.ESCALATE,
      escalate_if_fails: false
    };
  }

  // Last retry attempt → immediate retry
  if (ctx.attemptCount === ctx.maxAttempts - 1) {
    return {
      risk_level: RISK_LEVELS.HIGH,
      recovery_action: RECOVERY_ACTIONS.RETRY_PAYMENT,
      reason: `This is the last available retry attempt. Recommending immediate retry before exhausting all options.`,
      confidence: 0.75,
      delay_minutes: 5,
      max_retries: 1,
      secondary_action: RECOVERY_ACTIONS.ESCALATE,
      escalate_if_fails: true
    };
  }

  // Default fallback → conservative retry
  return {
    risk_level: RISK_LEVELS.MEDIUM,
    recovery_action: RECOVERY_ACTIONS.SCHEDULE_RETRY,
    reason: `Uncertain failure pattern. Conservative retry scheduled to attempt recovery without aggressive action.`,
    confidence: 0.55,
    delay_minutes: 120,
    max_retries: 1,
    secondary_action: null,
    escalate_if_fails: true
  };
};

// ─── Real Gemini AI Engine ──────────────────────────────────────────────────

const getGeminiDecision = async (transaction) => {
  const context = buildAIContext(transaction);

  const prompt = `You are an AI payment recovery analyst for an Indian payment gateway. 
Analyze the following failed transaction and recommend the best recovery action.

TRANSACTION CONTEXT:
${JSON.stringify(context, null, 2)}

INSTRUCTIONS:
1. Analyze the failure reason, customer history, and transaction context
2. Determine the risk level and best recovery action
3. Consider the customer's payment history and success rate
4. Only recommend actions from the allowed list
5. Be conservative — when unsure, escalate rather than retry aggressively

RESPOND WITH ONLY VALID JSON (no markdown, no explanation, just the JSON object):
{
  "risk_level": "low | medium | high | critical",
  "recovery_action": "one of the allowed actions",
  "reason": "1-3 sentence explanation of your recommendation",
  "confidence": 0.0 to 1.0,
  "delay_minutes": null or number between 5-10080,
  "max_retries": null or number between 1-5,
  "secondary_action": null or "another allowed action",
  "escalate_if_fails": true or false
}`;

  const genAI = new GoogleGenerativeAI(AI_CONFIG.apiKey);
  const model = genAI.getGenerativeModel({ model: AI_CONFIG.model });

  // Create abort controller for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AI_CONFIG.timeoutMs);

  try {
    const result = await model.generateContent(prompt, {
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    const responseText = result.response.text().trim();

    // Try to extract JSON from the response
    let parsed;
    try {
      // Handle case where Gemini wraps JSON in markdown code blocks
      const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      const jsonStr = jsonMatch ? jsonMatch[1] : responseText;
      parsed = JSON.parse(jsonStr);
    } catch (parseError) {
      logger.error('Failed to parse Gemini response as JSON', {
        transactionId: transaction.transactionId,
        rawResponse: responseText.substring(0, 500)
      });
      return { success: false, error: 'Invalid JSON response from AI', rawResponse: responseText };
    }

    // Validate the response schema
    const validation = validateAIResponse(parsed);
    if (!validation.valid) {
      logger.error('Gemini response failed schema validation', {
        transactionId: transaction.transactionId,
        errors: validation.errors
      });
      return { success: false, error: 'Schema validation failed', validationErrors: validation.errors, rawResponse: parsed };
    }

    return { success: true, decision: parsed };

  } catch (error) {
    clearTimeout(timeoutId);

    if (error.name === 'AbortError') {
      logger.error('Gemini API timeout', { transactionId: transaction.transactionId });
      return { success: false, error: 'AI API timeout' };
    }

    logger.error('Gemini API error', {
      transactionId: transaction.transactionId,
      error: error.message
    });
    return { success: false, error: `AI API error: ${error.message}` };
  }
};

// ─── Main AI Engine Function ────────────────────────────────────────────────

/**
 * Get AI decision for a transaction.
 * Uses mock mode or real Gemini based on configuration.
 * 
 * @param {Object} transaction - Transaction document
 * @returns {{ success: boolean, decision?: Object, error?: string, mockMode: boolean }}
 */
const getDecision = async (transaction) => {
  const isMock = AI_CONFIG.useMockAI;

  logger.info('AI engine invoked', {
    transactionId: transaction.transactionId,
    mode: isMock ? 'mock' : 'real_gemini',
    failureCode: transaction.failureCode
  });

  if (isMock) {
    // Simulate API latency
    await new Promise(resolve => setTimeout(resolve, 200));

    const decision = getMockDecision(transaction);

    // Validate mock response too (consistency check)
    const validation = validateAIResponse(decision);
    if (!validation.valid) {
      logger.error('Mock AI produced invalid response', { errors: validation.errors });
      return { success: false, error: 'Mock AI internal error', mockMode: true };
    }

    return { success: true, decision, mockMode: true };
  }

  // Real Gemini mode
  const result = await getGeminiDecision(transaction);
  return { ...result, mockMode: false };
};

module.exports = { getDecision, validateAIResponse, buildAIContext, getMockDecision };
