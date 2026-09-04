# AI Revenue Recovery Agent

AI-powered service that detects failed payments, evaluates recovery risk, chooses a safe recovery action, and executes approved retries through a secure Payment Processing System (PPS) API.

The system is designed to recover otherwise lost revenue while maintaining idempotency, policy checks, auditability, and clear recovery metrics.

## Live Demo

**Recovery Agent:**  
https://ai-revenue-recovery-agent-x294.onrender.com

**Payment Processing System:**  
https://payment-processing-system-sz7e.onrender.com

## What It Does

When a payment fails, the Payment Processing System sends the failure event to the Recovery Agent.

The Recovery Agent then:

1. Receives and verifies the payment failure webhook.
2. Normalizes the payment failure data.
3. Evaluates the payment's recovery risk.
4. Uses rules and AI to determine the appropriate recovery action.
5. Validates the action against recovery policies.
6. Creates a recovery case and action.
7. Executes approved actions through the PPS API.
8. Verifies the actual payment result.
9. Records the recovered amount, audit trail, and recovery metrics.

## Architecture

```text
                    Payment Processing System
                              │
                              │ payment.failed
                              ▼
                   AI Revenue Recovery Agent
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
              Risk Detection       Rule / Gemini AI
                    │                   │
                    └─────────┬─────────┘
                              ▼
                       Policy Validation
                              │
                              ▼
                       Recovery Decision
                              │
                              ▼
                         Retry Payment
                              │
                              ▼
                    PPS Internal Retry API
                              │
                              ▼
                    Actual Payment Retry
                              │
                       ┌──────┴──────┐
                       ▼             ▼
                    Success        Failure
                       │             │
                       ▼             ▼
                 Amount Recovered   Audit
                       │
                       ▼
                Recovery Metrics
