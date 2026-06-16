# Usage-Based Billing System

A small usage-based billing platform: customers consume products measured in units;
their wallet balance is updated accordingly under concurrent access, with guaranteed
data consistency.

> **Status:** design phase. This repo currently holds the domain glossary and the
> architecture decision records. Implementation (Node.js · TypeScript · SQLite ·
> Prisma · Docker Compose · React) follows the decisions captured below.

## Architecture decisions

The load-bearing decisions, each with full context and trade-offs, live in
[`docs/adr/`](docs/adr/):

| ADR | Decision |
|---|---|
| [0001](docs/adr/0001-atomic-conditional-balance-deduction.md) | Atomic conditional balance deduction (`updateMany` guard) under concurrency |
| [0002](docs/adr/0002-idempotent-consumption-via-unique-key.md) | Idempotent consumption via a client-supplied unique key |
| [0003](docs/adr/0003-polling-for-freshness.md) | Polling for dashboard freshness (push designed, not built) |
| [0004](docs/adr/0004-monotonic-cursor-for-history-pagination.md) | Monotonic integer id for stable history pagination |

The domain language is defined in [`CONTEXT.md`](CONTEXT.md).

## Design summary

**Consistency (primary concern)**
- SQLite in WAL mode + `busy_timeout`, on a shared volume across 2–3 instances behind nginx.
- Correctness comes from an **atomic conditional write** — `UPDATE … WHERE balance >= cost`
  (Prisma `updateMany`, check rows affected), not from WAL. Race-proof, single statement,
  Postgres-portable. WAL is a concurrency mode only.
- Hybrid model: a mutable `balance` (source of truth for the guard) plus an append-only
  `LedgerEntry`, written together in one transaction.
- Money as **integer minor units**; `CHECK (balance >= 0)` as database-level defense-in-depth.

**Idempotency** — client `Idempotency-Key` header → `@unique` column → dedup via constraint
violation inside the deduction transaction.

**Freshness** — polling (React Query, ~5s) with refetch on the client's own mutations. A
Socket.IO + Redis-adapter push design is documented as the "with more time / on Postgres"
path; it was de-scoped because high event volume requires server-side coalescing (which
polling gets for free) and external writers require CDC (unavailable on SQLite) or a
transactional outbox.

**API** — resource-creation semantics; `402` for insufficient funds (Stripe-aligned);
`404` / `422` / `400` error taxonomy with a shared error envelope; express-validator at the
route boundary; existence and funds checks in the service layer.

**No authentication** — out of scope for an internal dashboard; in production every endpoint
would sit behind service-to-service auth / an API gateway.

## What I'd improve with more time

- Move to Postgres for row-level locking (parallel writes across customers); SQLite has a
  single database-wide write lock.
- Build the documented Socket.IO + Redis live-push layer (with coalescing) on top of polling.
- Add CDC / a transactional outbox to capture consumptions applied by external systems.
- A sortable ULID instead of an autoincrement id if ledger ids were exposed externally.

## Running

The whole stack runs with Docker only — no local Node, SQLite, or Prisma needed:

```sh
docker compose up --build
```

- **Dashboard:** http://localhost:5173
- **API:** http://localhost:4000 (e.g. `GET /products`)

On startup the backend applies Prisma migrations (`prisma migrate deploy`) and runs
the idempotent seed (~10 Products with varied prices, in integer minor units). SQLite
lives on a named volume and is opened in WAL mode with `busy_timeout` (docs/adr/0001).

### Local development (optional)

```sh
# backend
cd backend && npm install
cp .env.example .env
npx prisma migrate dev      # creates the SQLite db + runs the seed
npm run dev                 # http://localhost:4000
npm test                    # integration tests against a real temp SQLite file

# frontend
cd frontend && npm install
npm run dev                 # http://localhost:5173 (proxies /api -> :4000)
```

## Project layout

```
backend/    Node.js · TypeScript · Express · Prisma · SQLite
frontend/   React · Vite · React Query
docker-compose.yml   one command brings up the full stack
```
