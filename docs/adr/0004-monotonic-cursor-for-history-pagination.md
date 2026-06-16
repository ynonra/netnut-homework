# 4. Monotonic integer id for stable history pagination

Date: 2026-06-16

## Status

Accepted

## Context

The customer detail view pages through a Customer's Usage history, newest-first.
A single Customer may generate thousands of Consumption Events per minute, so the
history table is the one unbounded, high-write surface, and pagination must stay
correct and cheap as it grows.

Cursor pagination (not OFFSET) is required: OFFSET re-counts skipped rows and
degrades as the table grows. But a cursor keyed purely on `createdAt` is unstable
under this write rate — thousands of events per minute guarantee timestamp
collisions, so rows sharing a `createdAt` can be skipped or duplicated at page
boundaries.

Other models use `cuid()` ids, which are not time-sortable and cannot serve as a
pagination tiebreaker.

## Decision

`LedgerEntry` uses an autoincrement `Int` primary key — monotonic and sortable.
History is paginated with a compound index `(customerId, createdAt)` for the seek,
and the cursor carries the `Int` id as a stable, unique, monotonic tiebreaker. The
id strategy is intentionally different from the `cuid()` used elsewhere, because
this table is the only one that is both high-write and cursor-paginated.

## Consequences

- Page boundaries are stable even when many events share a timestamp — no skipped
  or duplicated rows.
- One index seek + range scan per page, no in-memory sort, at any table size.
- Mixed id strategy across models (cuid elsewhere, Int here) — documented here so
  the inconsistency reads as deliberate.
- A sequential Int id is enumerable/guessable; acceptable for an internal ledger
  row id. If exposed externally and that mattered, a sortable ULID would give
  monotonicity without enumerability.
