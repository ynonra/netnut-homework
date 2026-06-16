-- Add the client-minted idempotency key to consumption ledger rows (docs/adr/0002).
-- Nullable: omitted Idempotency-Key headers store NULL and are not deduped. The
-- UNIQUE index makes a replayed key collide inside the consume transaction; SQLite
-- treats each NULL as distinct, so multiple header-less rows coexist freely.

-- AlterTable
ALTER TABLE "LedgerEntry" ADD COLUMN "idempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_idempotencyKey_key" ON "LedgerEntry"("idempotencyKey");
