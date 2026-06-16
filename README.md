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
- SQLite in WAL mode + `busy_timeout`, on one shared named volume across **three backend
  instances behind an nginx round-robin proxy** (see [Multi-instance deployment](#multi-instance-deployment)).
- Correctness comes from an **atomic conditional write** — `UPDATE … WHERE balance >= cost`
  (Prisma `updateMany`, check rows affected), not from WAL. Race-proof, single statement,
  Postgres-portable. WAL is a concurrency mode only.
- This holds **across processes**: a concurrent overspend race fired through the proxy lands
  on different backend instances, yet exactly one consume succeeds, the balance never goes
  negative, and exactly one ledger row is written — proven by an automated test
  (`backend/test/cross-process-race.test.ts`) that stands up the real stack.
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

- **API entrypoint** is the nginx proxy on `:4000`, which round-robins across the
  three backend instances.

On startup a one-shot `migrate` container applies Prisma migrations (`prisma migrate
deploy`) and runs the idempotent seed (~10 Products with varied prices, in integer
minor units) exactly once; the three serving backends wait for it to complete, then
start. SQLite lives on a single named volume shared by all instances, opened in WAL
mode with `busy_timeout` (docs/adr/0001).

### Multi-instance deployment

`docker compose up` runs **three backend processes** (`backend-1/2/3`) behind an
**nginx round-robin reverse proxy** (`nginx/nginx.conf`), all sharing **one SQLite
file** on a named volume. This makes the cross-process consistency claim watchable:
a burst of concurrent consumes is spread across the three processes by the proxy, yet
the final balance is exactly correct.

A single dedicated `migrate` service owns schema migration + seed so the serving
instances never run `migrate deploy` concurrently (which would race on the schema).

The connection pool is shaped for SQLite's lock: `connection_limit=1` per process, so
concurrent consumes queue cleanly in Prisma's pool and `busy_timeout` makes contending
writers across processes **wait** for the single write lock rather than erroring.

**Cross-process race test** — `npm run test:cross-process` (from `backend/`, requires
Docker) stands up the whole stack, fires N concurrent consumes at the proxy against a
balance that affords exactly one, and asserts: exactly one `201`, the rest `402`, final
balance exactly `0` (never negative), and exactly one ledger row. It is excluded from
the default `npm test` (which is dependency-free).

> **Throughput ceiling.** SQLite has a **single database-wide write lock**: every
> consume across every customer and every instance serializes through it. nginx and
> three processes add availability and spread CPU, but **not write throughput** — the
> write lock is the ceiling. The upgrade is **Postgres**, whose row-level locking lets
> different customers' wallets commit in parallel (the identical `updateMany` guard
> ports unchanged). See "What I'd improve with more time".

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
backend/    Node.js · TypeScript · Express · Prisma · SQLite (×3 instances)
frontend/   React · Vite · React Query
nginx/      round-robin reverse proxy in front of the backend instances
docker-compose.yml   one command brings up the full stack
```
