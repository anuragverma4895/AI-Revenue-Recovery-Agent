# AI Revenue Recovery Agent

Separate production-ready service for receiving Payment Processing System payment failure events, analyzing recovery risk, creating recovery cases/actions, and executing approved recovery actions through PPS APIs only.

## Architecture

This repository stays separate from the Payment Processing System repository.

- Recovery Agent owns failed-event intake, normalization, risk detection, AI/rule decisions, policy validation, recovery cases, recovery actions, audit logs, and recovery metrics.
- Payment Processing System owns orders, payments, payment status, actual payment execution, actual retries, and PPS database state.
- Recovery Agent never writes to PPS MongoDB collections. It communicates with PPS only through webhooks and APIs.

## Integration Flow

PPS sends failed payments to Recovery Agent:

```text
PPS -> POST /api/webhooks/payment-failed
```

Recovery Agent verifies HMAC, validates the safe payload, normalizes `gatewayResponse`, upserts a transaction, runs risk/decision/policy logic, creates at most one recovery case, and writes audit logs.

For `retry_payment`, Recovery Agent calls PPS:

```text
POST ${PAYMENT_PROCESSING_URL}/api/internal/retry-payment
x-internal-api-key: <INTERNAL_API_KEY>
```

The request contains only safe fields such as `orderId`, `recoveryActionId`, and optional `method`. It never sends card numbers, CVV, JWTs, passwords, or secrets. Recovery Agent marks a case recovered only when PPS confirms the retry succeeded with successful payment/order state.

## API Endpoints

- `GET /api/health`
- `POST /api/webhooks/payment-failed`
- `POST /api/transactions/seed`
- `GET /api/transactions?source=seed|payment_processing_system`
- `GET /api/transactions/:transactionId`
- `POST /api/recovery/analyze`
- `POST /api/recovery/execute/:caseId`
- `POST /api/recovery/execute-all`
- `GET /api/recovery/cases?source=seed|payment_processing_system`
- `GET /api/recovery/cases/:caseId`
- `GET /api/metrics/summary?source=seed|payment_processing_system`
- `GET /api/metrics/breakdown?source=seed|payment_processing_system`
- `GET /api/audit`
- `GET /api/audit/:transactionId`

## Environment Variables

Create `server/.env` from `server/.env.example`.

```env
PORT=5001
NODE_ENV=development
MONGODB_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/revenue-recovery
PAYMENT_PROCESSING_URL=http://localhost:5000
PPS_REQUEST_TIMEOUT_MS=15000
INTERNAL_API_KEY=replace_with_shared_internal_api_key
WEBHOOK_SECRET=replace_with_shared_webhook_secret
USE_MOCK_AI=true
GEMINI_API_KEY=replace_with_gemini_api_key
GEMINI_MODEL=gemini-2.0-flash
GEMINI_TIMEOUT_MS=10000
MAX_RETRY_ATTEMPTS=5
AI_CONFIDENCE_THRESHOLD=0.5
MAX_AUTO_RECOVERY_AMOUNT=100000
```

For Render, set the same backend variables. Change only `PAYMENT_PROCESSING_URL` to point at the deployed PPS backend, for example `https://<deployed-payment-processing-system-url>`. `INTERNAL_API_KEY` must match PPS. `WEBHOOK_SECRET` must match the secret PPS uses to sign recovery webhooks.

## Local Development

```bash
npm install --prefix server
npm install --prefix client
npm run dev --prefix server
npm run dev --prefix client
```

The frontend uses `/api` and Vite proxies to the backend. Override dev proxy with `VITE_DEV_API_PROXY_TARGET` if needed.

## Seed Mode

`POST /api/transactions/seed` loads synthetic demo data with `source=seed`. It removes only previous seed data and does not delete real `source=payment_processing_system` transactions/cases. Metrics can be filtered by source so demo data and real PPS recovery data are distinguishable.

## Deployment

Render can deploy this repository as one web service using `render.yaml`.

- Build command: `npm install --prefix server && npm install --prefix client && npm run build --prefix client`
- Start command: `npm start --prefix server`
- Health check: `/api/health`

Do not commit `server/.env`, logs, build output, or `.codex-runtime/`.