import { PrismaClient } from "@prisma/client";

/**
 * Single shared PrismaClient instance.
 */
export const prisma = new PrismaClient();

/**
 * Put SQLite into WAL mode and set a busy_timeout at startup (docs/adr/0001).
 *
 * WAL lets readers proceed without blocking the write storm, and busy_timeout
 * makes contending writers queue instead of erroring with SQLITE_BUSY. WAL is a
 * concurrency mode only — correctness comes from the atomic conditional write.
 *
 * Idempotent: safe to call once per process at boot.
 */
export async function configureSqlite(client: PrismaClient = prisma): Promise<void> {
  // These PRAGMAs return a result row in SQLite, so $queryRawUnsafe (not
  // $executeRawUnsafe, which rejects result-returning statements) must be used.
  await client.$queryRawUnsafe("PRAGMA journal_mode = WAL;");
  await client.$queryRawUnsafe("PRAGMA busy_timeout = 5000;");
  await client.$queryRawUnsafe("PRAGMA synchronous = NORMAL;");
}
