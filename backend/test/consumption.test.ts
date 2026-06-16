import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Express } from "express";
import type { PrismaClient } from "@prisma/client";

/**
 * Integration tests for POST /consumption-events against a REAL temp SQLite file
 * (no mocks). The migrations are applied (so the CHECK constraint and the
 * LedgerEntry table/index are real), WAL + busy_timeout are configured at startup,
 * then the Express app is mounted and exercised over HTTP.
 *
 * The headline test is the overspend race (docs/adr/0001): N concurrent consumes
 * against a balance that affords exactly one → exactly one success, the rest 402,
 * final balance 0, exactly one ledger row.
 */
let app: Express;
let prisma: PrismaClient;
let tmpDir: string;
let dbPath: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "netnut-consume-test-"));
  dbPath = join(tmpDir, "test.db");
  // SQLite has a single database-wide write lock (docs/adr/0001), so a single
  // connection is the right pool shape: concurrent consumes queue cleanly in
  // Prisma's pool and run one at a time, instead of many connections fighting the
  // write lock and exhausting busy_timeout. pool_timeout gives queued requests
  // room to wait rather than erroring.
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

describe("POST /consumption-events", () => {
  it("deducts the cost and writes one ledger row on success", async () => {
    const supertest = (await import("supertest")).default;
    await seedProduct("p_ok", 250);
    await seedCustomer("c_ok", 1000);

    const res = await supertest(app)
      .post("/consumption-events")
      .send({ customerId: "c_ok", productId: "p_ok", quantity: 3 });

    expect(res.status).toBe(201);
    expect(res.body.data.type).toBe("CONSUMPTION");
    expect(res.body.data.amount).toBe(-750);

    const customer = await prisma.customer.findUnique({ where: { id: "c_ok" } });
    expect(customer?.balance).toBe(250); // 1000 - 250*3

    const ledger = await prisma.ledgerEntry.findMany({ where: { customerId: "c_ok" } });
    expect(ledger.length).toBe(1);
    expect(ledger[0].productId).toBe("p_ok");
    expect(ledger[0].quantity).toBe(3);
    expect(ledger[0].unitPrice).toBe(250);
  });

  it("returns 402 with { error, balance, required } on insufficient funds", async () => {
    const supertest = (await import("supertest")).default;
    await seedProduct("p_exp", 1000);
    await seedCustomer("c_poor", 500);

    const res = await supertest(app)
      .post("/consumption-events")
      .send({ customerId: "c_poor", productId: "p_exp", quantity: 1 });

    expect(res.status).toBe(402);
    expect(res.body).toEqual({
      error: "insufficient_funds",
      balance: 500,
      required: 1000,
    });

    // Nothing deducted, no ledger row written (transaction rolled back).
    const customer = await prisma.customer.findUnique({ where: { id: "c_poor" } });
    expect(customer?.balance).toBe(500);
    const ledger = await prisma.ledgerEntry.count({ where: { customerId: "c_poor" } });
    expect(ledger).toBe(0);
  });

  it("rejects a non-positive / non-integer quantity with 400", async () => {
    const supertest = (await import("supertest")).default;
    await seedProduct("p_v", 10);
    await seedCustomer("c_v", 1000);

    for (const quantity of [0, -1, 1.5, "2", null]) {
      const res = await supertest(app)
        .post("/consumption-events")
        .send({ customerId: "c_v", productId: "p_v", quantity });
      expect(res.status).toBe(400);
    }
    // No deduction occurred for any of the invalid requests.
    const customer = await prisma.customer.findUnique({ where: { id: "c_v" } });
    expect(customer?.balance).toBe(1000);
  });

  it("returns 404 for an unknown customer or product", async () => {
    const supertest = (await import("supertest")).default;
    await seedProduct("p_nf", 10);
    await seedCustomer("c_nf", 1000);

    const noProduct = await supertest(app)
      .post("/consumption-events")
      .send({ customerId: "c_nf", productId: "missing", quantity: 1 });
    expect(noProduct.status).toBe(404);

    const noCustomer = await supertest(app)
      .post("/consumption-events")
      .send({ customerId: "missing", productId: "p_nf", quantity: 1 });
    expect(noCustomer.status).toBe(404);
  });
});

describe("overspend race (docs/adr/0001)", () => {
  it("N concurrent consumes against a single-purchase balance → exactly one success", async () => {
    const supertest = (await import("supertest")).default;
    const N = 50;
    const UNIT_PRICE = 100;
    // Balance affords exactly ONE purchase of quantity 1.
    await seedProduct("p_race", UNIT_PRICE);
    await seedCustomer("c_race", UNIT_PRICE);

    const results = await Promise.all(
      Array.from({ length: N }, () =>
        supertest(app)
          .post("/consumption-events")
          .send({ customerId: "c_race", productId: "p_race", quantity: 1 }),
      ),
    );

    const successes = results.filter((r) => r.status === 201);
    const rejected = results.filter((r) => r.status === 402);

    expect(successes.length).toBe(1);
    expect(rejected.length).toBe(N - 1);

    // Final balance is exactly 0 — no overspend, no negative balance.
    const customer = await prisma.customer.findUnique({ where: { id: "c_race" } });
    expect(customer?.balance).toBe(0);

    // Exactly one ledger row — the deduction and insert are one transaction.
    const ledgerCount = await prisma.ledgerEntry.count({
      where: { customerId: "c_race" },
    });
    expect(ledgerCount).toBe(1);
  });
});

describe("idempotent consumption (docs/adr/0002)", () => {
  it("replays a duplicate Idempotency-Key without a second deduction", async () => {
    const supertest = (await import("supertest")).default;
    await seedProduct("p_idem", 100);
    await seedCustomer("c_idem", 1000);
    const key = "idem-replay-key-1";

    const first = await supertest(app)
      .post("/consumption-events")
      .set("Idempotency-Key", key)
      .send({ customerId: "c_idem", productId: "p_idem", quantity: 2 });
    expect(first.status).toBe(201);
    expect(first.body.data.amount).toBe(-200);

    // Retry with the SAME key → original row returned, no second charge.
    const replay = await supertest(app)
      .post("/consumption-events")
      .set("Idempotency-Key", key)
      .send({ customerId: "c_idem", productId: "p_idem", quantity: 2 });
    expect(replay.status).toBe(201);
    // Same ledger row id — it is the original, not a new charge.
    expect(replay.body.data.id).toBe(first.body.data.id);

    // Charged exactly once: balance 1000 - 200 = 800, one ledger row.
    const customer = await prisma.customer.findUnique({ where: { id: "c_idem" } });
    expect(customer?.balance).toBe(800);
    const ledgerCount = await prisma.ledgerEntry.count({
      where: { customerId: "c_idem" },
    });
    expect(ledgerCount).toBe(1);
  });

  it("processes a new key as a deliberate second charge", async () => {
    const supertest = (await import("supertest")).default;
    await seedProduct("p_idem2", 100);
    await seedCustomer("c_idem2", 1000);

    await supertest(app)
      .post("/consumption-events")
      .set("Idempotency-Key", "key-a")
      .send({ customerId: "c_idem2", productId: "p_idem2", quantity: 1 });
    // A DIFFERENT key is a new submission → it charges again.
    await supertest(app)
      .post("/consumption-events")
      .set("Idempotency-Key", "key-b")
      .send({ customerId: "c_idem2", productId: "p_idem2", quantity: 1 });

    const customer = await prisma.customer.findUnique({ where: { id: "c_idem2" } });
    expect(customer?.balance).toBe(800); // two charges of 100
    const ledgerCount = await prisma.ledgerEntry.count({
      where: { customerId: "c_idem2" },
    });
    expect(ledgerCount).toBe(2);
  });

  it("processes header-less requests normally (no dedup), so curl stays simple", async () => {
    const supertest = (await import("supertest")).default;
    await seedProduct("p_nokey", 100);
    await seedCustomer("c_nokey", 1000);

    // Two identical requests with NO Idempotency-Key → two distinct charges.
    await supertest(app)
      .post("/consumption-events")
      .send({ customerId: "c_nokey", productId: "p_nokey", quantity: 1 });
    await supertest(app)
      .post("/consumption-events")
      .send({ customerId: "c_nokey", productId: "p_nokey", quantity: 1 });

    const customer = await prisma.customer.findUnique({ where: { id: "c_nokey" } });
    expect(customer?.balance).toBe(800);
    const ledgerCount = await prisma.ledgerEntry.count({
      where: { customerId: "c_nokey" },
    });
    expect(ledgerCount).toBe(2);
  });

  it("double-fire: same key sent concurrently → exactly one charge, one ledger row", async () => {
    const supertest = (await import("supertest")).default;
    const N = 20;
    const UNIT_PRICE = 100;
    await seedProduct("p_double", UNIT_PRICE);
    // Balance affords MANY purchases — so any extra charge would be visible as a
    // lower balance / extra row. The single charge is enforced by the key, not by
    // running out of funds.
    await seedCustomer("c_double", UNIT_PRICE * N);
    const key = "double-fire-key";

    const results = await Promise.all(
      Array.from({ length: N }, () =>
        supertest(app)
          .post("/consumption-events")
          .set("Idempotency-Key", key)
          .send({ customerId: "c_double", productId: "p_double", quantity: 1 }),
      ),
    );

    // Every concurrent request resolves successfully (201) — the replays return
    // the original row rather than erroring (docs/adr/0002).
    expect(results.every((r) => r.status === 201)).toBe(true);
    // All responses reference the SAME ledger row.
    const ids = new Set(results.map((r) => r.body.data.id));
    expect(ids.size).toBe(1);

    // Charged exactly once despite N concurrent fires of the same key.
    const customer = await prisma.customer.findUnique({
      where: { id: "c_double" },
    });
    expect(customer?.balance).toBe(UNIT_PRICE * N - UNIT_PRICE);
    const ledgerCount = await prisma.ledgerEntry.count({
      where: { customerId: "c_double" },
    });
    expect(ledgerCount).toBe(1);
  });
});
