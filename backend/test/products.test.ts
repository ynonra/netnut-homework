import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Express } from "express";

/**
 * Integration test against a REAL temp SQLite file (no mocks).
 *
 * We point DATABASE_URL at a throwaway file, push the Prisma schema into it, run
 * the seed, then mount the Express app and exercise GET /products over HTTP.
 */
let app: Express;
let tmpDir: string;
let dbPath: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "netnut-test-"));
  dbPath = join(tmpDir, "test.db");
  process.env.DATABASE_URL = `file:${dbPath}`;

  const cwd = join(__dirname, "..");
  // Create the schema in the temp DB without a migration history.
  execSync("npx prisma db push --skip-generate --accept-data-loss", {
    cwd,
    env: process.env,
    stdio: "pipe",
  });

  // Import after DATABASE_URL is set and the client is generated.
  const { prisma, configureSqlite } = await import("../src/db/prisma");
  await configureSqlite(prisma);
  const { seed } = await import("../prisma/seed");
  await seed(prisma);

  const { createApp } = await import("../src/app");
  app = createApp();
});

afterAll(async () => {
  const { prisma } = await import("../src/db/prisma");
  await prisma.$disconnect();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("GET /products", () => {
  it("returns the seeded catalog as JSON", async () => {
    const supertest = (await import("supertest")).default;
    const res = await supertest(app).get("/products");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(10);

    const first = res.body.data[0];
    expect(typeof first.id).toBe("string");
    expect(typeof first.name).toBe("string");
    // unitPrice must be an integer (minor units), never a float.
    expect(Number.isInteger(first.unitPrice)).toBe(true);
  });

  it("is ordered by name", async () => {
    const supertest = (await import("supertest")).default;
    const res = await supertest(app).get("/products");
    const names = res.body.data.map((p: { name: string }) => p.name);
    const sorted = [...names].sort();
    expect(names).toEqual(sorted);
  });
});

describe("seed idempotency", () => {
  it("re-running the seed does not duplicate products", async () => {
    const { prisma } = await import("../src/db/prisma");
    const { seed } = await import("../prisma/seed");
    await seed(prisma);
    const count = await prisma.product.count();
    expect(count).toBe(10);
  });
});
