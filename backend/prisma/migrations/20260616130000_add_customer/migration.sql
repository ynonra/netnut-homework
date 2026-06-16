-- CreateTable
-- The CHECK (balance >= 0) constraint is written by hand here: Prisma cannot model
-- a column CHECK natively, so it is added via raw SQL in the migration. It defends
-- the no-negative-balance invariant at the database level; the atomic deduction
-- guard (docs/adr/0001) remains the primary enforcement.
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "balance" INTEGER NOT NULL CHECK ("balance" >= 0),
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
