import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Express } from "express";
import type { PrismaClient } from "@prisma/client";

/**
 * Integration tests for GET /customers/:id/usage-events (consumption history, US-B,
 * docs/adr/0004) against a REAL temp SQLite file (no mocks). Migrations are applied,
 * WAL + busy_timeout configured, then the Express app is exercised over HTTP.
 *
 * The headline checks: newest-first ordering, cursor pagination keyed on the Int id
 * (never OFFSET), full coverage with no skipped/duplicated rows across page
 * boundaries even when many rows share a createdAt, and a graceful empty history.
 */
let app: Express;
let prisma: PrismaClient;
let tmpDir: string;
let dbPath: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "netnut-usage-test-"));
  dbPath = join(tmpDir, "test.db");
  process.env.DATABASE_URL = `file:${dbPath}?connection_limit=1&pool_timeout=30`;

  const cwd = join(__dirname, "..");
  execSync("npx prisma migrate deploy", { cwd, env: process.env, stdio: "pipe" });

  const db = await import("../src/db/prisma");
  prisma = db.prisma;
  await db.configureSqlite(prisma);

  const { createApp } = await import("../src/app");
  app = createApp();
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(tmpDir, { recursive: true, force: true });
});

async function seedCustomer(id: string, balance: number) {
  await prisma.customer.upsert({
    where: { id },
    create: { id, name: id, balance },
    update: { balance },
  });
}

describe("GET /customers/:id/usage-events", () => {
  it("returns 404 for an unknown customer (distinct from empty history)", async () => {
    const supertest = (await import("supertest")).default;
    const res = await supertest(app).get("/customers/nope/usage-events");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("not_found");
  });

  it("returns an empty page (not 404) for a customer with no usage", async () => {
    const supertest = (await import("supertest")).default;
    await seedCustomer("c_empty", 1000);

    const res = await supertest(app).get("/customers/c_empty/usage-events");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.nextCursor).toBeNull();
  });

  it("returns newest-first, mixing CONSUMPTION and CREDIT rows", async () => {
    const supertest = (await import("supertest")).default;
    await seedCustomer("c_mixed", 0);

    // Insert a credit then a consumption; ids are monotonic, so newest-first means
    // the later-inserted row comes first.
    await prisma.ledgerEntry.create({
      data: { customerId: "c_mixed", type: "CREDIT", amount: 500 },
    });
    await prisma.ledgerEntry.create({
      data: {
        customerId: "c_mixed",
        type: "CONSUMPTION",
        productId: "p_x",
        quantity: 2,
        unitPrice: 100,
        amount: -200,
      },
    });

    const res = await supertest(app).get("/customers/c_mixed/usage-events");
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(2);
    // Newest first: the CONSUMPTION (inserted last → higher id) leads.
    expect(res.body.data[0].type).toBe("CONSUMPTION");
    expect(res.body.data[1].type).toBe("CREDIT");
    // Strictly descending ids.
    expect(res.body.data[0].id).toBeGreaterThan(res.body.data[1].id);
  });

  it("pages through the full history via the cursor with no gaps or duplicates", async () => {
    const supertest = (await import("supertest")).default;
    await seedCustomer("c_page", 0);

    // Many rows sharing the SAME createdAt — the exact case a createdAt-only cursor
    // would mishandle (docs/adr/0004). The Int id keeps the boundary stable.
    const TOTAL = 57;
    const sharedTime = new Date("2026-01-01T00:00:00.000Z");
    await prisma.ledgerEntry.createMany({
      data: Array.from({ length: TOTAL }, (_, i) => ({
        customerId: "c_page",
        type: "CONSUMPTION",
        productId: "p_y",
        quantity: 1,
        unitPrice: 10,
        amount: -10,
        createdAt: sharedTime,
      })),
    });

    const LIMIT = 10;
    const seen: number[] = [];
    let cursor: number | null | undefined = undefined;
    let pages = 0;

    do {
      const url =
        `/customers/c_page/usage-events?limit=${LIMIT}` +
        (cursor != null ? `&cursor=${cursor}` : "");
      const res = await supertest(app).get(url);
      expect(res.status).toBe(200);
      for (const row of res.body.data) seen.push(row.id);
      cursor = res.body.nextCursor;
      pages++;
      expect(pages).toBeLessThan(20); // guard against an infinite loop
    } while (cursor != null);

    // Every row seen exactly once.
    expect(seen.length).toBe(TOTAL);
    expect(new Set(seen).size).toBe(TOTAL);
    // Strictly descending across the whole run — newest-first, stable boundaries.
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]).toBeLessThan(seen[i - 1]);
    }
  });

  it("clamps an oversized limit and rejects a malformed one", async () => {
    const supertest = (await import("supertest")).default;
    await seedCustomer("c_lim", 0);
    await prisma.ledgerEntry.createMany({
      data: Array.from({ length: 5 }, () => ({
        customerId: "c_lim",
        type: "CONSUMPTION",
        productId: "p_z",
        quantity: 1,
        unitPrice: 1,
        amount: -1,
      })),
    });

    // Oversized limit is clamped (MAX 100), still returns successfully.
    const ok = await supertest(app).get("/customers/c_lim/usage-events?limit=99999");
    expect(ok.status).toBe(200);
    expect(ok.body.data.length).toBe(5);

    // Malformed limit / cursor → 400.
    const badLimit = await supertest(app).get("/customers/c_lim/usage-events?limit=0");
    expect(badLimit.status).toBe(400);
    const badCursor = await supertest(app).get(
      "/customers/c_lim/usage-events?cursor=abc",
    );
    expect(badCursor.status).toBe(400);
  });
});
