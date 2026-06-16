import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Express } from "express";
import type { PrismaClient } from "@prisma/client";

/**
 * Integration test against a REAL temp SQLite file (no mocks).
 *
 * Points DATABASE_URL at a throwaway file, pushes the Prisma schema into it, runs
 * the seed, then mounts the Express app and exercises GET /customers over HTTP.
 * Also asserts the raw-SQL CHECK (balance >= 0) constraint actually rejects a
 * negative balance at the database level (docs/adr/0001).
 */
let app: Express;
let prisma: PrismaClient;
let tmpDir: string;
let dbPath: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "netnut-cust-test-"));
  dbPath = join(tmpDir, "test.db");
  process.env.DATABASE_URL = `file:${dbPath}`;

  const cwd = join(__dirname, "..");
  // Apply the real migrations so the hand-written CHECK constraint is exercised.
  execSync("npx prisma migrate deploy", {
    cwd,
    env: process.env,
    stdio: "pipe",
  });

  const db = await import("../src/db/prisma");
  prisma = db.prisma;
  await db.configureSqlite(prisma);
  const { seed } = await import("../prisma/seed");
  await seed(prisma);

  const { createApp } = await import("../src/app");
  app = createApp();
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("GET /customers", () => {
  it("returns the seeded customers with integer balances", async () => {
    const supertest = (await import("supertest")).default;
    const res = await supertest(app).get("/customers");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(6);

    for (const c of res.body.data) {
      expect(typeof c.id).toBe("string");
      expect(typeof c.name).toBe("string");
      // balance must be an integer (minor units), never a float.
      expect(Number.isInteger(c.balance)).toBe(true);
      expect(c.balance).toBeGreaterThanOrEqual(0);
    }
  });

  it("is ordered by name", async () => {
    const supertest = (await import("supertest")).default;
    const res = await supertest(app).get("/customers");
    const names = res.body.data.map((c: { name: string }) => c.name);
    expect(names).toEqual([...names].sort());
  });

  it("seeds at least one depleted, one near-zero (low), and several healthy", async () => {
    const supertest = (await import("supertest")).default;
    const res = await supertest(app).get("/customers");
    const balances: number[] = res.body.data.map(
      (c: { balance: number }) => c.balance,
    );
    const LOW = 5_00;
    expect(balances.some((b) => b === 0)).toBe(true); // depleted
    expect(balances.some((b) => b > 0 && b <= LOW)).toBe(true); // low
    expect(balances.filter((b) => b > LOW).length).toBeGreaterThanOrEqual(2); // healthy
  });
});

describe("CHECK (balance >= 0) constraint", () => {
  it("rejects a negative balance at the database level", async () => {
    await expect(
      prisma.customer.create({
        data: { id: "cust_negative", name: "Negative", balance: -1 },
      }),
    ).rejects.toThrow();
  });
});

describe("seed idempotency", () => {
  it("re-running the seed does not duplicate customers", async () => {
    const { seed } = await import("../prisma/seed");
    await seed(prisma);
    const count = await prisma.customer.count();
    expect(count).toBe(6);
  });
});
