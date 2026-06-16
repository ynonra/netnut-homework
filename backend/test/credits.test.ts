import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Express } from "express";
import type { PrismaClient } from "@prisma/client";

/**
 * Integration tests for POST /customers/:id/credits (Top-up, US-B) against a REAL
 * temp SQLite file (no mocks). The migrations are applied, WAL + busy_timeout are
 * configured at startup, then the Express app is mounted and exercised over HTTP.
 *
 * The headline test is the concurrency consistency check (docs/adr/0001): a burst
 * of interleaved credits and consumes on one Wallet leaves the Balance equal to
 * the exact net of every applied delta — atomic increment/decrement, no lost
 * updates.
 */
let app: Express;
let prisma: PrismaClient;
let tmpDir: string;
let dbPath: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "netnut-credits-test-"));
  dbPath = join(tmpDir, "test.db");
  // Single connection: SQLite has one database-wide write lock (docs/adr/0001), so
  // concurrent writes queue cleanly in Prisma's pool instead of fighting the lock.
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

async function seedProduct(id: string, unitPrice: number) {
  await prisma.product.upsert({
    where: { id },
    create: { id, name: id, unitPrice },
    update: { unitPrice },
  });
}

async function seedCustomer(id: string, balance: number) {
  await prisma.customer.upsert({
    where: { id },
    create: { id, name: id, balance },
    update: { balance },
  });
}

describe("POST /customers/:id/credits", () => {
  it("increments the balance and writes one CREDIT ledger row on success", async () => {
    const supertest = (await import("supertest")).default;
    await seedCustomer("c_credit", 500);

    const res = await supertest(app)
      .post("/customers/c_credit/credits")
      .send({ amount: 1500 });

    expect(res.status).toBe(201);
    expect(res.body.data.type).toBe("CREDIT");
    expect(res.body.data.amount).toBe(1500);
    expect(res.body.data.customerId).toBe("c_credit");
    // A top-up is not tied to a Product.
    expect(res.body.data.productId).toBeNull();
    expect(res.body.data.quantity).toBeNull();

    const customer = await prisma.customer.findUnique({ where: { id: "c_credit" } });
    expect(customer?.balance).toBe(2000); // 500 + 1500

    const ledger = await prisma.ledgerEntry.findMany({
      where: { customerId: "c_credit" },
    });
    expect(ledger.length).toBe(1);
    expect(ledger[0].type).toBe("CREDIT");
    expect(ledger[0].amount).toBe(1500);
  });

  it("rejects a non-positive / non-integer amount with 400 and no mutation", async () => {
    const supertest = (await import("supertest")).default;
    await seedCustomer("c_credit_v", 1000);

    for (const amount of [0, -1, 1.5, "100", null, undefined]) {
      const res = await supertest(app)
        .post("/customers/c_credit_v/credits")
        .send({ amount });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_request");
    }

    // No credit applied, no ledger row for any invalid request.
    const customer = await prisma.customer.findUnique({
      where: { id: "c_credit_v" },
    });
    expect(customer?.balance).toBe(1000);
    const ledger = await prisma.ledgerEntry.count({
      where: { customerId: "c_credit_v" },
    });
    expect(ledger).toBe(0);
  });

  it("returns 404 for an unknown customer and writes nothing", async () => {
    const supertest = (await import("supertest")).default;
    const before = await prisma.ledgerEntry.count();

    const res = await supertest(app)
      .post("/customers/missing-customer/credits")
      .send({ amount: 100 });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("not_found");

    // The transaction rolled back: no orphan ledger row was inserted.
    const after = await prisma.ledgerEntry.count();
    expect(after).toBe(before);
  });
});

describe("concurrent credits + consumes stay consistent (docs/adr/0001)", () => {
  it("interleaved atomic increments and decrements net to the exact balance", async () => {
    const supertest = (await import("supertest")).default;
    const UNIT_PRICE = 100;
    const START = 10_000;
    await seedProduct("p_mix", UNIT_PRICE);
    await seedCustomer("c_mix", START);

    const CREDITS = 30;
    const CONSUMES = 20; // all affordable: START is large enough for every consume
    const CREDIT_AMOUNT = 50;

    const ops: Promise<unknown>[] = [];
    for (let i = 0; i < CREDITS; i++) {
      ops.push(
        supertest(app)
          .post("/customers/c_mix/credits")
          .send({ amount: CREDIT_AMOUNT }),
      );
    }
    for (let i = 0; i < CONSUMES; i++) {
      ops.push(
        supertest(app)
          .post("/consumption-events")
          .send({ customerId: "c_mix", productId: "p_mix", quantity: 1 }),
      );
    }

    await Promise.all(ops);

    // No lost updates: every increment and decrement applied exactly once.
    const expected = START + CREDITS * CREDIT_AMOUNT - CONSUMES * UNIT_PRICE;
    const customer = await prisma.customer.findUnique({ where: { id: "c_mix" } });
    expect(customer?.balance).toBe(expected);

    // One ledger row per applied operation: CREDITS credits + CONSUMES consumes.
    const credits = await prisma.ledgerEntry.count({
      where: { customerId: "c_mix", type: "CREDIT" },
    });
    const consumes = await prisma.ledgerEntry.count({
      where: { customerId: "c_mix", type: "CONSUMPTION" },
    });
    expect(credits).toBe(CREDITS);
    expect(consumes).toBe(CONSUMES);
  });
});
