# 2. Idempotent consumption via a client-supplied unique key

Date: 2026-06-16

## Status

Accepted

## Context

The atomic conditional deduction (ADR 0001) prevents overspend and lost updates,
but not duplicate charges from retries: if a client POSTs a Consumption Event and
the *response* is lost, a retry charges the Wallet twice. Both requests are
well-formed and individually correct — this is a separate axis from lost updates.

Consumption is not naturally idempotent on its content: a Customer legitimately
consuming the same Quantity of the same Product twice is two real events. So the
dedup key cannot be derived from request content; only the client knows whether an
HTTP call is "the same action retried" or "a deliberate second action."

## Decision

Client-supplied idempotency, deduped by a database UNIQUE constraint:

- The frontend mints a UUID (`crypto.randomUUID()`) once per consume-form
  submission and sends it as an `Idempotency-Key` header. Retries of that
  submission reuse the same key; a new submission mints a new key.
- The Consumption Event row carries a `@unique idempotencyKey` column. Inside the
  deduction transaction, inserting the event with a duplicate key throws a unique
  constraint violation — that violation *is* the "already processed" signal. It is
  caught and treated as a replay (the original event is returned), so no second
  deduction occurs.
- The header is optional. Omitted → processed normally without dedup (keeps manual
  `curl` testing simple).

## Consequences

- A retried submission charges exactly once.
- Concurrent duplicates need no special handling: the second INSERT blocks on
  SQLite's write lock until the first commits, then hits the unique violation and
  is treated as a replay. (Stripe returns 409 here because it is distributed; a
  single SQLite write lock serializes it instead.)
- Reuses the ADR 0001 philosophy — the database, via a constraint, is the arbiter
  of the invariant; no application-memory check is trusted.
- Replay returns a reconstructed result, not a byte-for-byte cached HTTP response.
  Acceptable: the meaningful guarantee (charged once) is preserved.
- Costs one column and one unique index; no separate key store or TTL sweeper.
