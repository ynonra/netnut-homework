# 1. Atomic conditional balance deduction under concurrency

Date: 2026-06-16

## Status

Accepted

## Context

A Consumption Event must deduct its Cost from a Wallet Balance only if sufficient
Credits exist, and never let the Balance go negative. Multiple service instances
run simultaneously, and a single Customer may generate thousands of Consumption
Events per minute. The mandated storage is SQLite, accessed through Prisma.

The obvious approach — read the Balance, check `balance >= cost` in application
code, then write the new Balance — is a read-modify-write race. Two concurrent
events both read the same Balance, both pass the check, both deduct, and the
Wallet overspends (lost update). With WAL snapshot isolation the read can also be
stale, making the race more likely, not less.

Prisma's `update` only accepts a *unique* `where`, so the `balance >= cost`
condition cannot be expressed in it. That API shape pushes implementers toward the
unsafe read-then-write pattern.

## Decision

Deduct using a single atomic conditional statement, expressed in Prisma as
`updateMany`:

```ts
const { count } = await prisma.wallet.updateMany({
  where: { id: customerId, balance: { gte: cost } },
  data: { balance: { decrement: cost } },
});
if (count === 0) throw new InsufficientFundsError();
```

The funds check lives **inside** the UPDATE's `WHERE` clause, evaluated under
SQLite's write lock against the latest committed row. `count === 1` means the
deduction succeeded; `count === 0` means insufficient funds. There is no
application-memory check and no preceding SELECT, so there is no race window.

The deduction and the append-only Usage Event (ledger) insert are wrapped in a
single `$transaction` so they commit or roll back together.

SQLite is run in WAL mode with `busy_timeout` set at startup (via raw PRAGMA), so
readers never block the write storm and contending writers queue instead of
erroring. WAL is a concurrency mode only — correctness comes entirely from the
atomic conditional write and holds even without WAL.

## Consequences

- No overspend, no negative balance, no lost update, under any concurrency.
- One indexed write per event instead of read-then-write — fewer round trips and
  less write-lock contention than the naive approach.
- The mechanism is database-agnostic: the identical pattern runs on Postgres with
  row-level locking, where different Customers' wallets write in parallel.
- SQLite has a single database-wide write lock, so all writes serialize regardless
  of Customer. That is SQLite's throughput ceiling and the reason a real
  deployment would use Postgres. (See README "what I'd improve".)
- `updateMany` is used to touch a single row purely because it is the only Prisma
  method that carries a non-unique condition and reports rows affected.
