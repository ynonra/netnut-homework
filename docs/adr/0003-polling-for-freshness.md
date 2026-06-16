# 3. Polling for dashboard freshness (push documented, not built)

Date: 2026-06-16

## Status

Accepted

## Context

The dashboard must stay fresh as Customers consume and are credited, and stay
usable as data grows. Multiple service instances run simultaneously, and a single
Customer may generate thousands of Consumption Events per minute. Consumptions may
also originate from systems other than this backend.

A live-push design was considered in full: Socket.IO with the official
`@socket.io/redis-adapter` for cross-instance fan-out, rooms per Customer, emit
strictly after commit, refetch-on-reconnect as a correctness backstop.

Two facts undermined push as a *primary* freshness mechanism:

1. **Volume.** Thousands of events/min per Customer means naive per-event emits
   flood clients with intermediate balances no one can read. Push would need
   server-side coalescing (emit the latest balance at most once per ~500ms–1s) to
   become usable — a property polling has for free, since reading current balance
   every N seconds inherently collapses intermediate churn.

2. **External writers.** Emit-after-commit only fires for writes this app handles.
   A consumption applied by another system never triggers an emit, so pushed
   clients silently drift. Capturing *all* writes needs Change Data Capture
   (unavailable on SQLite — its update_hook is per-process) or a transactional
   outbox (requires every writer to cooperate). Polling is the only mechanism that
   reflects arbitrary writers without cooperation or DB-level CDC.

## Decision

Freshness is by polling (React Query `refetchInterval`, ~5s) plus immediate
refetch/optimistic update on the client's own mutations. The DB is the source of
truth; the UI converges to it on each poll regardless of who wrote.

Usability as data grows: the unbounded Consumption history is cursor-paginated
(`?cursor=&limit=`), newest-first; list endpoints stay small (~10 Customers).

The Socket.IO + Redis-adapter push design is documented in the README as the
"with more time / on Postgres" architecture, including the coalescing and
CDC/outbox requirements that make it correct.

## Consequences

- Correct under multiple instances and external writers — polling reads DB truth
  and is naturally coalescing under high event volume.
- Up to ~5s staleness; acceptable for a balance dashboard.
- Steady request volume from polling; fine at this scale, and cheaper in
  engineering time than a push layer that would still need polling underneath it.
- Cursor pagination avoids OFFSET degradation as history grows.
- No Socket.IO/Redis runtime dependency to operate.
