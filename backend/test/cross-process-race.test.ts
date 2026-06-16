import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

/**
 * CROSS-PROCESS overspend-race test (issue #7, docs/adr/0001).
 *
 * Unlike consumption.test.ts — which proves the atomic guard inside ONE process
 * against a temp SQLite file — this test stands up the REAL docker-compose stack:
 * THREE backend processes behind an nginx round-robin proxy, all sharing ONE SQLite
 * file on a named volume. It fires a burst of concurrent consumes at the proxy, so
 * the requests land on DIFFERENT processes, and asserts the system is still exactly
 * consistent:
 *
 *   - exactly ONE consume succeeds (201), the rest are 402,
 *   - the balance never goes negative (final balance is exactly 0),
 *   - exactly ONE new ledger row is written.
 *
 * Correctness here cannot come from in-process coordination (there are three
 * processes); it comes entirely from the atomic conditional UPDATE under SQLite's
 * single database-wide write lock (docs/adr/0001).
 *
 * This test requires Docker and is therefore EXCLUDED from the default `npm test`
 * (which has no external dependencies). Run it with `npm run test:cross-process`.
 */

const REPO_ROOT = join(__dirname, "..", "..");
const PROXY = "http://localhost:4000";

// A burst large enough to make the race real across three processes.
const N = 60;

// Seeded fixtures (backend/prisma/seed.ts): a customer that starts at balance 0,
// and the cheapest product (unitPrice 1). Topping the customer up by exactly 1
// makes the wallet afford EXACTLY ONE consume of quantity 1.
const CUSTOMER_ID = "cust_soylent";
const PRODUCT_ID = "prod_api_call";
const UNIT_PRICE = 1;

function compose(args: string[], opts: { timeout?: number } = {}): string {
  return execFileSync("docker", ["compose", ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: opts.timeout ?? 180_000,
  });
}

/**
 * Run a tiny Prisma script inside a backend container against the SHARED db on the
 * named volume. Used to read the authoritative ledger-row count — the API exposes
 * no history endpoint, and this asserts the "exactly one ledger row" criterion
 * directly against the database every process writes to.
 */
function queryInContainer(script: string): string {
  return execFileSync(
    "docker",
    ["compose", "exec", "-T", "backend-1", "node", "-e", script],
    { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 },
  ).trim();
}

function countConsumptionRows(customerId: string): number {
  const out = queryInContainer(
    `const{PrismaClient}=require('@prisma/client');` +
      `const p=new PrismaClient();` +
      `p.ledgerEntry.count({where:{customerId:'${customerId}',type:'CONSUMPTION'}})` +
      `.then(c=>{process.stdout.write(String(c));return p.$disconnect();})` +
      `.catch(e=>{console.error(e);process.exit(1);});`,
  );
  return Number(out);
}

async function getBalance(customerId: string): Promise<number> {
  const res = await fetch(`${PROXY}/customers`);
  if (!res.ok) throw new Error(`GET /customers -> ${res.status}`);
  const body = (await res.json()) as { data: { id: string; balance: number }[] };
  const c = body.data.find((x) => x.id === customerId);
  if (!c) throw new Error(`customer ${customerId} not found`);
  return c.balance;
}

async function waitForProxy(timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${PROXY}/health`);
      if (res.ok) return;
      lastErr = new Error(`/health -> ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`proxy never became healthy: ${String(lastErr)}`);
}

beforeAll(async () => {
  // Bring the whole stack up fresh (down -v clears any prior shared volume so the
  // seed is deterministic), then build + start in the background and wait for the
  // proxy to pass through to a healthy backend.
  compose(["down", "-v", "--remove-orphans"], { timeout: 120_000 });
  compose(["up", "-d", "--build"], { timeout: 300_000 });
  await waitForProxy();
}, 360_000);

afterAll(() => {
  // Always tear the stack (and its volume) down.
  try {
    compose(["down", "-v", "--remove-orphans"], { timeout: 120_000 });
  } catch {
    // best-effort cleanup
  }
});

describe("cross-process overspend race through the nginx proxy (docs/adr/0001)", () => {
  it("fires N concurrent consumes across 3 processes → exactly one success, balance never negative, one ledger row", async () => {
    // Sanity: the customer starts depleted (seed gives cust_soylent balance 0).
    expect(await getBalance(CUSTOMER_ID)).toBe(0);

    const ledgerBefore = countConsumptionRows(CUSTOMER_ID);

    // Top the wallet up to EXACTLY one purchase (price of prod_api_call = 1).
    const topup = await fetch(`${PROXY}/customers/${CUSTOMER_ID}/credits`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amount: UNIT_PRICE }),
    });
    expect(topup.status).toBe(201);
    expect(await getBalance(CUSTOMER_ID)).toBe(UNIT_PRICE);

    // Fire the burst at the PROXY — round-robin spreads them across the 3 backends.
    const results = await Promise.all(
      Array.from({ length: N }, () =>
        fetch(`${PROXY}/consumption-events`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            customerId: CUSTOMER_ID,
            productId: PRODUCT_ID,
            quantity: 1,
          }),
        }),
      ),
    );

    const statuses = results.map((r) => r.status);
    const successes = statuses.filter((s) => s === 201).length;
    const rejected = statuses.filter((s) => s === 402).length;

    // Exactly one success; every other request is a clean 402 (no 500s, no errors:
    // contending writers queued on the lock rather than erroring — busy_timeout).
    expect(successes).toBe(1);
    expect(rejected).toBe(N - 1);
    expect(successes + rejected).toBe(N);

    // Balance is exactly 0 — never negative, no overspend — read back through the
    // proxy (i.e. from a possibly-different process than the one that charged).
    expect(await getBalance(CUSTOMER_ID)).toBe(0);

    // Exactly ONE new ledger row, asserted against the shared db every process
    // writes to.
    const ledgerAfter = countConsumptionRows(CUSTOMER_ID);
    expect(ledgerAfter - ledgerBefore).toBe(1);
  }, 120_000);
});
