# KoinX — Transaction Reconciliation Engine

A production-grade **Node.js + TypeScript** backend that ingests two crypto transaction datasets (user-exported vs exchange-exported), runs a multi-pass matching engine, and produces a structured reconciliation report.

---

## Table of Contents

1. [Tech Stack](#tech-stack)
2. [Project Structure](#project-structure)
3. [Quick Start](#quick-start)
4. [Docker Setup](#docker-setup)
5. [Environment Variables](#environment-variables)
6. [API Reference](#api-reference)
7. [Swagger Docs](#swagger-docs)
8. [Matching Algorithm](#matching-algorithm)
9. [Reconciliation Categories](#reconciliation-categories)
10. [CSV Report Format](#csv-report-format)
11. [Data Quality Handling](#data-quality-handling)
12. [Running Tests](#running-tests)
13. [Seed Script](#seed-script)
14. [Decisions on Unclear Requirements](#decisions-on-unclear-requirements)


---

## Tech Stack

| Layer | Technology | Why |
|---|---|---|
| Runtime | Node.js 20 | Required by assignment |
| Language | TypeScript (strict) | Safer, more impressive than JS |
| Framework | Express.js | Lightweight, industry standard |
| Database | MongoDB + Mongoose | Preferred by assignment |
| Validation | Zod | Runtime-safe schema validation with clear error messages |
| CSV Parsing | csv-parse | Robust, stream-based, handles messy CSVs |
| CSV Writing | csv-stringify | Consistent report output |
| Logging | Winston | Structured JSON logs, file + console |
| Testing | Jest + ts-jest | 15 unit tests covering all matching logic |
| Docs | Swagger / OpenAPI 3.0 | Live interactive API docs at `/api-docs` |
| Containerisation | Docker + docker-compose | One-command startup |

---

## Project Structure

```
src/
├── config/
│   ├── index.ts                     # All env-based config in one place
│   └── swagger.ts                   # OpenAPI spec definition
│
├── controllers/
│   └── reconciliation.controller.ts # Route handlers, decoupled from routing
│
├── models/
│   ├── Transaction.ts               # Mongoose schema for individual transactions
│   └── ReconciliationRun.ts         # Mongoose schema for a full run + all entries
│
├── routes/
│   └── reconciliation.routes.ts     # Express router + Swagger JSDoc annotations
│
├── scripts/
│   └── seed.ts                      # npm run seed — loads sample data
│
├── services/
│   ├── ingestion.service.ts         # CSV parsing, validation, DB persistence
│   ├── matching.service.ts          # Core matching engine (ID + proximity)
│   ├── reconciliation.service.ts    # Orchestrator tying all services together
│   └── report.service.ts            # DB queries + CSV report generation
│
├── tests/
│   └── matching.engine.test.ts      # 15 Jest unit tests
│
├── types/
│   └── index.ts                     # All shared TypeScript interfaces
│
├── utils/
│   ├── assetNormalizer.ts           # BTC/bitcoin alias resolution
│   ├── date.utils.ts                # Timestamp helpers
│   ├── logger.ts                    # Winston structured logger
│   └── quantity.utils.ts            # Quantity diff helpers
│
├── validations/
│   └── reconcile.validation.ts      # Zod schema for POST /reconcile body
│
├── app.ts                           # Express app (middleware, routes, error handler)
└── server.ts                        # MongoDB connect + server bootstrap
```

---

## Quick Start

### Prerequisites

- Node.js ≥ 18
- MongoDB running locally (or use Docker below)

```bash
# 1. Clone
git clone https://github.com/Amolraut638/koinx-reconciliation-engine.git
cd reconciliation-engine

# 2. Install
npm install

# 3. Configure
cp .env.example .env
# Edit .env if needed (MongoDB URI, tolerances)

# 4. Build
npm run build

# 5. Start
npm start

# Dev mode (auto-reload)
npm run dev
```

Server starts on `http://localhost:3000`
Swagger docs at `http://localhost:3000/api-docs`

---

## Docker Setup

No local MongoDB needed. One command:

```bash
docker-compose up --build
```

This starts:
- **`reconciliation-engine`** — the API server on port 3000
- **`reconciliation-mongo`** — MongoDB 7 with a health check

Generated CSV reports are mounted to `./reports/` on your host.
Logs are mounted to `./logs/`.

```bash
# Stop
docker-compose down

# Stop and remove volumes
docker-compose down -v
```

---

## Environment Variables

All matching tolerances are **configurable without code changes**.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP server port |
| `MONGODB_URI` | `mongodb://localhost:27017/reconciliation-engine` | MongoDB connection string |
| `TIMESTAMP_TOLERANCE_SECONDS` | `300` | Max timestamp delta (±5 min) → **MATCHED** |
| `QUANTITY_TOLERANCE_PCT` | `0.0001` | Max quantity % delta (0.01%) → **MATCHED** (decimal, e.g. `0.0001` = 0.01%) |
| `CONFLICT_WINDOW_SECONDS` | `86400` | Max timestamp delta (24 h) → **CONFLICTING** (beyond this = UNMATCHED) |
| `CONFLICT_WINDOW_QTY_PCT` | `0.5` | Max quantity % delta (50%) → **CONFLICTING** (beyond this = UNMATCHED) |
| `USER_CSV_PATH` | `./data/user_transactions.csv` | Override path to user transactions CSV |
| `EXCHANGE_CSV_PATH` | `./data/exchange_transactions.csv` | Override path to exchange transactions CSV |

Per-request overrides via `POST /reconcile` body take priority over env vars.

---

## API Reference

### `POST /reconcile`

Trigger a reconciliation run. All body fields are optional.

```bash
curl -X POST http://localhost:3000/reconcile \
  -H "Content-Type: application/json" \
  -d '{
    "timestampToleranceSeconds": 300,
    "quantityTolerancePct": 0.0001
  }'
```

**Request body** (all optional):

| Field | Type | Description |
|---|---|---|
| `timestampToleranceSeconds` | number | Override timestamp match tolerance |
| `quantityTolerancePct` | number (0–1) | Override quantity match tolerance |
| `conflictWindowSeconds` | number | Override conflict window (must be ≥ timestampToleranceSeconds) |
| `conflictWindowQtyPct` | number (0–1) | Override conflict quantity window |
| `userCsvPath` | string | Path to user CSV (overrides env) |
| `exchangeCsvPath` | string | Path to exchange CSV (overrides env) |

**Response `200`:**
```json
{
  "runId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "completed",
  "summary": {
    "matched": 18,
    "conflicting": 1,
    "unmatchedUser": 5,
    "unmatchedExchange": 2,
    "dataQualityIssues": 7
  },
  "csvReportPath": "./reports/reconciliation_<runId>.csv"
}
```

**Response `400`** (Zod validation failure):
```json
{
  "error": "Validation failed",
  "details": [
    "conflictWindowSeconds: conflictWindowSeconds must be >= timestampToleranceSeconds"
  ]
}
```

---

### `GET /report/:runId`

Full report — all entries with both sides, category, reason, match method, and conflict details.

```bash
curl http://localhost:3000/report/550e8400-e29b-41d4-a716-446655440000
```

---

### `GET /report/:runId/summary`

Counts only — fast lightweight response.

```bash
curl http://localhost:3000/report/550e8400-e29b-41d4-a716-446655440000/summary
```

```json
{
  "runId": "550e8400-...",
  "ranAt": "2024-03-01T09:00:00.000Z",
  "config": {
    "timestampToleranceSeconds": 300,
    "quantityTolerancePct": 0.0001,
    "conflictWindowSeconds": 86400,
    "conflictWindowQtyPct": 0.5
  },
  "totalUserTransactions": 27,
  "totalExchangeTransactions": 25,
  "matched": 18,
  "conflicting": 1,
  "unmatchedUser": 5,
  "unmatchedExchange": 2,
  "dataQualityIssues": 7
}
```

---

### `GET /report/:runId/unmatched`

Only `UNMATCHED_USER` and `UNMATCHED_EXCHANGE` entries — useful for manual review queue.

```bash
curl http://localhost:3000/report/550e8400-.../unmatched
```

---

### `GET /health`

```json
{
  "status": "ok",
  "mongo": "connected",
  "uptime": "42s",
  "timestamp": "2024-03-01T09:00:42.000Z"
}
```

---

## Swagger Docs

Interactive docs at **`http://localhost:3000/api-docs`** — try all endpoints directly from the browser.

---

## Matching Algorithm

Matching runs in **four sequential passes**. Each pass claims transactions; later passes only see what's left.

```
┌─────────────────────────────────────────────────────────────┐
│                    POST /reconcile                          │
│                         │                                   │
│              ┌──────────▼──────────┐                        │
│              │   Ingestion Layer   │ Parse CSVs, validate,  │
│              │                     │ flag quality issues,   │
│              │                     │ persist to MongoDB      │
│              └──────────┬──────────┘                        │
│                         │                                   │
│              ┌──────────▼──────────┐                        │
│              │   Matching Engine   │                        │
│              │                     │                        │
│              │  Pass 1: ID Match   │ Exact transactionId    │
│              │  Pass 2: Proximity  │ Asset+Type+Score       │
│              │  Pass 3: Invalid    │ Bad rows → UNMATCHED   │
│              │  Pass 4: Remainder  │ Unclaimed exchange     │
│              └──────────┬──────────┘                        │
│                         │                                   │
│              ┌──────────▼──────────┐                        │
│              │   Report Generator  │ Save to MongoDB +      │
│              │                     │ Write CSV report        │
│              └─────────────────────┘                        │
└─────────────────────────────────────────────────────────────┘
```

### Pass 1 — ID-based matching (exact)

If a user `transaction_id` exists in the exchange dataset:
- Asset + type compatible + within **match tolerance** → `MATCHED` (method: `id`)
- Asset + type compatible + outside **match tolerance** → `CONFLICTING` (method: `id`)
- Asset or type mismatch despite same ID → `CONFLICTING` with field diff noted

ID matches take priority over proximity matches.

### Pass 2 — Proximity-based matching

For remaining valid user transactions:

1. Filter exchange candidates: same normalised asset + compatible type
2. Filter to candidates within the **conflict window** (both timestamp and quantity)
3. Score each: `(timeDiff_minutes) + (qtyDiffPct × 100)` — lower = better
4. Best candidate within **match tolerance** → `MATCHED` (method: `proximity`)
5. Best candidate outside match tolerance, inside conflict window → `CONFLICTING`
6. No candidate at all → `UNMATCHED_USER`

### Pass 3 — Invalid user transactions

Rows that failed validation are emitted as `UNMATCHED_USER` with the specific issue as the reason.

### Pass 4 — Remaining exchange transactions

Any exchange row not claimed → `UNMATCHED_EXCHANGE`.

---

### TRANSFER Perspective Flip

| User sees | Exchange sees | Reality |
|---|---|---|
| `TRANSFER_OUT` | `TRANSFER_IN` | Same event, opposite perspective |

These are treated as **compatible types** — the match succeeds, and the reason string notes the flip explicitly.

### Asset Alias Resolution

| Raw value | Normalised to |
|---|---|
| `bitcoin`, `btc` | `BTC` |
| `ethereum`, `eth` | `ETH` |
| `solana`, `sol` | `SOL` |
| `tether`, `usdt` | `USDT` |
| `polygon`, `matic` | `MATIC` |
| `chainlink`, `link` | `LINK` |

Aliases are case-insensitive. Unknown assets are uppercased and matched as-is.

---

## Reconciliation Categories

| Category | Meaning |
|---|---|
| `MATCHED` | Both sides within timestamp AND quantity tolerance |
| `CONFLICTING` | Best candidate found (by ID or proximity), but key fields differ beyond tolerance |
| `UNMATCHED_USER` | Present in user file; no candidate within conflict window in exchange file |
| `UNMATCHED_EXCHANGE` | Present in exchange file; no candidate within conflict window in user file |

---

## CSV Report Format

Generated at `reports/reconciliation_<runId>.csv`.

| Column | Description |
|---|---|
| `category` | MATCHED / CONFLICTING / UNMATCHED_USER / UNMATCHED_EXCHANGE |
| `match_method` | `id` or `proximity` (empty for unmatched) |
| `reason` | Human-readable explanation with deltas |
| `user_transaction_id` | User-side ID |
| `user_timestamp` | User-side timestamp (ISO 8601) |
| `user_type` | User-side type |
| `user_asset` | User-side asset (normalised) |
| `user_quantity` | User-side quantity |
| `user_price_usd` | User-side price |
| `user_fee` | User-side fee |
| `user_quality_issues` | Pipe-delimited quality issues for this row |
| `exchange_*` | Same columns for exchange side |
| `conflicts` | Pipe-delimited `field:delta` pairs for CONFLICTING rows |

---

## Data Quality Handling

Bad rows are **never silently dropped**. Every issue is:
1. Logged via Winston with the raw row
2. Stored in MongoDB under `qualityIssues[]` on the transaction document
3. Included in the CSV report as the `reason`

| Issue | Row | Handling |
|---|---|---|
| Malformed timestamp (`2024-03-09T`) | `USR-018` | `[timestamp] Malformed timestamp` → UNMATCHED_USER |
| Missing timestamp | `USR-024` | `[timestamp] Missing timestamp` → UNMATCHED_USER |
| Negative quantity (`-0.1`) | `USR-019` | `[quantity] Negative quantity` → UNMATCHED_USER |
| Duplicate transaction ID | `USR-001` (×2) | Second occurrence flagged → UNMATCHED_USER |
| Asset alias (`bitcoin`) | `USR-005` | Normalised to `BTC` → MATCHED with EXC-1005 |
| Quantity mismatch (`0.3` vs `0.3001`) | `USR-012` / `EXC-1012` | 0.0333% diff > 0.01% tolerance → CONFLICTING |
| Exchange-only transactions | `EXC-1024`, `EXC-1025` | UNMATCHED_EXCHANGE |

---

## Running Tests

```bash
# Run all tests
npm test

# With coverage report
npm run test:coverage
```

**15 tests** covering:

| Suite | Tests |
|---|---|
| Proximity matching | Within tolerance → MATCHED, quantity conflict → CONFLICTING, out of window → UNMATCHED |
| ID-based matching | Shared ID → MATCHED, shared ID + field diff → CONFLICTING |
| TRANSFER perspective flip | TRANSFER_OUT ↔ TRANSFER_IN matches, TRANSFER_OUT ≠ BUY |
| Asset alias normalisation | bitcoin → BTC, ethereum → ETH, BTC ≠ ETH |
| Invalid row handling | Invalid → UNMATCHED_USER with reason, unclaimed exchange → UNMATCHED_EXCHANGE |
| Timestamp tolerance boundary | Exactly at tolerance → MATCHED, 1s over → CONFLICTING |
| No double-claiming | One exchange tx can only match one user tx |

---

## Seed Script

Loads the sample CSVs and runs a full reconciliation. Prints a summary to the console.

```bash
npm run seed
```

Output:
```
──────────────────────────────────────
✅ Seed successful!
   Run ID      : 550e8400-...
   Matched     : 18
   Conflicting : 1
   Unmatched   : 7
   Report      : ./reports/reconciliation_550e8400-....csv
──────────────────────────────────────
```

---

## Decisions on Unclear Requirements

### 1. What counts as a "match" when only one tolerance field is exceeded?

**Ambiguity:** Spec defines tolerances for timestamp and quantity but doesn't say what happens when one passes and the other fails.

**Decision:** Both tolerances must be satisfied simultaneously for `MATCHED`. If the best candidate fails either, the pair is `CONFLICTING` — they are clearly related transactions and surfacing the discrepancy is more useful than treating them as unrelated.

---

### 2. What is the boundary between CONFLICTING and UNMATCHED?

**Ambiguity:** The spec mentions CONFLICTING (matched by proximity, fields differ) and UNMATCHED, but doesn't define the outer boundary.

**Decision:** A separate **conflict window** (distinct from match tolerance) defines this boundary. Pairs within the conflict window but outside match tolerance → `CONFLICTING`. Pairs outside the conflict window → `UNMATCHED`. Both windows are independently configurable via env vars or per-request body.

| Window | Default | Meaning |
|---|---|---|
| Match tolerance (timestamp) | 300s (5 min) | Within this → MATCHED |
| Match tolerance (quantity) | 0.01% | Within this → MATCHED |
| Conflict window (timestamp) | 86400s (24 h) | Within this, outside match → CONFLICTING |
| Conflict window (quantity) | 50% | Within this, outside match → CONFLICTING |

---

### 3. TRANSFER_IN / TRANSFER_OUT — treat as equal or flag the asymmetry?

**Ambiguity:** The spec says they are "opposite perspectives" but doesn't specify whether to treat them as equal types or note the difference.

**Decision:** Treated as **compatible but not equal**. Match succeeds, and the reason string explicitly notes the perspective flip. This keeps the report transparent without blocking the match.

---

### 4. ID-based matching — when does it apply given different ID formats?

**Ambiguity:** The spec says "matched by ID or proximity." The sample data has different formats (`USR-001` vs `EXC-1001`) so no ID overlap exists. But the requirement clearly asks for it.

**Decision:** ID-based matching is implemented as **Pass 1** and runs unconditionally. For the sample data, Pass 1 finds nothing and Pass 2 (proximity) handles everything. For production data where a shared reference ID is present, Pass 1 takes priority. This is correct — the engine shouldn't assume no shared IDs will ever exist.

---

### 5. Is missing `price_usd` on TRANSFER rows a data quality issue?

**Ambiguity:** The spec asks to flag quality issues but doesn't list which fields are required for which transaction types.

**Decision:** `price_usd` is optional for all rows — it is not used in matching. Missing price on TRANSFER rows is accepted silently. Missing price on BUY/SELL rows is accepted with a debug log only, since it doesn't affect correctness.

---

### 6. Should duplicate IDs be checked within each source or across sources?

**Ambiguity:** The spec doesn't address duplicates.

**Decision:** Duplicates are checked **per source only**. The same ID in both files is the mechanism enabling ID-based cross-source matching. Flagging it as a duplicate would break Pass 1. Within a source, the second occurrence of a duplicate is marked invalid with a clear reason.

---

### 7. Should `/reconcile` be synchronous or asynchronous?

**Ambiguity:** At scale, reconciliation would be queued. The spec doesn't specify.

**Decision:** Synchronous for now — responds after the run completes. The `ReconciliationRun` document already has a `status` field (`pending → processing → completed/failed`). Switching to async (BullMQ or similar) requires only moving the orchestration to a background worker — the API contract stays identical.

---

### 8. How are the CSV files provided to the engine?

**Ambiguity:** The spec says "trigger reconciliation run" but doesn't define how files are provided.

**Decision:** Three-level override:
1. Per-request body (`userCsvPath`, `exchangeCsvPath`)
2. Environment variables (`USER_CSV_PATH`, `EXCHANGE_CSV_PATH`)
3. Default: `./data/user_transactions.csv` and `./data/exchange_transactions.csv`
