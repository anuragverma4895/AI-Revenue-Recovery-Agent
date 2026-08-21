# AI Revenue Recovery Agent

AI-powered revenue recovery system for failed, pending, and abandoned payment transactions. The app analyzes at-risk payments, creates recovery cases using rule-based and mock/real AI decisions, validates policy constraints, executes recovery actions, and keeps an immutable audit trail.

## Features

- Recovery dashboard with revenue, recovery rate, decision-source, and action metrics
- Transaction list and transaction detail views
- Risk detection for failed, pending, and abandoned payments
- Rule engine for deterministic recovery decisions
- Mock AI engine for local demos and optional Gemini integration for real AI decisions
- Policy validation before automated recovery
- Recovery case management with filters and per-case execution
- Audit log with event, transaction, action, and decision metadata
- Synthetic seed data for demos

## Tech Stack

- Frontend: React, Vite, React Router, Recharts, Lucide icons
- Backend: Node.js, Express, Mongoose
- Database: MongoDB
- AI: Mock AI by default, Gemini optional

## Project Structure

```text
client/   React frontend
server/   Express API, recovery engines, MongoDB models
```

## Setup

### 1. Install dependencies

```bash
cd client
npm install

cd ../server
npm install
```

### 2. Configure backend environment

Create `server/.env` from `server/.env.example` and set your MongoDB URI.

```env
PORT=5000
NODE_ENV=development
MONGODB_URI=your_mongodb_connection_string
USE_MOCK_AI=true
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-2.0-flash
```

For local demo mode, keep `USE_MOCK_AI=true`. Set `USE_MOCK_AI=false` only when a valid Gemini API key is configured.

### 3. Run the backend

```bash
cd server
npm run dev
```

The API runs on `http://localhost:5000`.

### 4. Run the frontend

```bash
cd client
npm run dev
```

The frontend runs on `http://localhost:5173` and proxies `/api` requests to the backend.

## Demo Flow

1. Open the Dashboard.
2. Click `Seed Data` to load synthetic transactions.
3. Click `Analyze` to create recovery cases.
4. Review cases on the Recovery Cases page.
5. Execute individual cases or use `Execute All` from the Dashboard.
6. Check the Audit Log for the full decision and execution trail.

## API Overview

- `GET /api/health`
- `POST /api/transactions/seed`
- `GET /api/transactions`
- `GET /api/transactions/:transactionId`
- `POST /api/recovery/analyze`
- `POST /api/recovery/execute/:caseId`
- `POST /api/recovery/execute-all`
- `GET /api/recovery/cases`
- `GET /api/recovery/cases/:caseId`
- `GET /api/metrics/summary`
- `GET /api/metrics/breakdown`
- `GET /api/audit`
- `GET /api/audit/:transactionId`

## Build

```bash
cd client
npm run build
```

## Notes

- Do not commit `server/.env`.
- MongoDB is required for the backend to start.
- The app works without Gemini when mock AI mode is enabled.
