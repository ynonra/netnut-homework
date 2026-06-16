import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * ~10 Products with varied prices, in integer minor units (cents).
 *
 * Deterministic and idempotent: each product has a fixed, stable id and is
 * upserted, so re-running the seed never creates duplicates and always converges
 * to the same catalog.
 */
const PRODUCTS: { id: string; name: string; unitPrice: number }[] = [
  { id: "prod_api_call", name: "API Call", unitPrice: 1 },
  { id: "prod_proxy_gb", name: "Proxy Bandwidth (GB)", unitPrice: 250 },
  { id: "prod_residential_gb", name: "Residential Proxy (GB)", unitPrice: 1200 },
  { id: "prod_datacenter_ip", name: "Datacenter IP", unitPrice: 50 },
  { id: "prod_serp_query", name: "SERP Query", unitPrice: 3 },
  { id: "prod_scrape_page", name: "Scraped Page", unitPrice: 8 },
  { id: "prod_storage_gb_month", name: "Storage (GB / month)", unitPrice: 99 },
  { id: "prod_geo_lookup", name: "Geo Lookup", unitPrice: 2 },
  { id: "prod_captcha_solve", name: "CAPTCHA Solve", unitPrice: 35 },
  { id: "prod_session_hour", name: "Sticky Session (hour)", unitPrice: 15 },
];

/**
 * Customers with balances in integer minor units (cents). Spans the full range the
 * low/depleted indicator must distinguish (US-A):
 *   - one depleted (balance === 0)
 *   - one near-zero / low (just under the LOW_BALANCE_THRESHOLD used by the UI)
 *   - several healthy
 *
 * Deterministic and idempotent: fixed ids, upserted, so re-running converges.
 */
const CUSTOMERS: { id: string; name: string; balance: number }[] = [
  { id: "cust_acme", name: "Acme Corp", balance: 1_000_00 },
  { id: "cust_globex", name: "Globex", balance: 250_00 },
  { id: "cust_initech", name: "Initech", balance: 42_00 },
  { id: "cust_umbrella", name: "Umbrella Inc", balance: 5_00 },
  { id: "cust_hooli", name: "Hooli", balance: 4_99 },
  { id: "cust_soylent", name: "Soylent", balance: 0 },
  // Heavy-consumption customer (US-B): hundreds of ledger rows spread over days,
  // forcing the cursor pagination on the detail view to actually page.
  { id: "cust_megascrape", name: "MegaScrape Ltd", balance: 5_000_00 },
  // No-consumption customer (US-B): never consumes, exercising the empty-history
  // state on the detail view.
  { id: "cust_quietco", name: "QuietCo (no usage)", balance: 100_00 },
];

/** The heavy-consumption customer whose history forces pagination. */
const HEAVY_CUSTOMER_ID = "cust_megascrape";
/** How many CONSUMPTION rows to fabricate for the heavy customer. */
const HEAVY_EVENT_COUNT = 420;
/** Spread the fabricated history across this many days, ending now. */
const HEAVY_SPAN_DAYS = 14;

/**
 * Fabricate a deterministic, dense Usage history for the heavy-consumption
 * customer so the detail view's cursor pagination (docs/adr/0004) has hundreds of
 * rows to page through, with timestamps spread realistically over days.
 *
 * Idempotent: it first deletes the heavy customer's existing CONSUMPTION rows, so
 * re-running the seed converges to exactly HEAVY_EVENT_COUNT rows rather than
 * accumulating. createdAt is set explicitly (oldest first) so the rows span a real
 * date range; ids are still assigned monotonically by autoincrement, giving the
 * stable tiebreaker the cursor relies on.
 *
 * The balance is NOT decremented here — these are backfilled history rows, and the
 * heavy customer's seeded balance stands on its own. Several rows deliberately
 * share a createdAt (events fabricated within the same second) to prove the cursor
 * stays stable under timestamp collisions.
 */
async function seedHeavyHistory(client: PrismaClient): Promise<void> {
  await client.ledgerEntry.deleteMany({
    where: { customerId: HEAVY_CUSTOMER_ID, type: "CONSUMPTION" },
  });

  const now = Date.now();
  const spanMs = HEAVY_SPAN_DAYS * 24 * 60 * 60 * 1000;

  const rows = Array.from({ length: HEAVY_EVENT_COUNT }, (_, i) => {
    // Oldest first so autoincrement id order matches chronological order.
    const product = PRODUCTS[i % PRODUCTS.length];
    const quantity = (i % 5) + 1;
    const cost = product.unitPrice * quantity;
    // Spread timestamps across the span. Integer-second granularity guarantees
    // adjacent events collide on createdAt — the case the Int-id cursor handles.
    const ageMs = Math.floor((spanMs * (HEAVY_EVENT_COUNT - 1 - i)) / HEAVY_EVENT_COUNT);
    const createdAt = new Date(Math.floor((now - ageMs) / 1000) * 1000);
    return {
      customerId: HEAVY_CUSTOMER_ID,
      type: "CONSUMPTION",
      productId: product.id,
      quantity,
      unitPrice: product.unitPrice,
      amount: -cost,
      createdAt,
    };
  });

  // createMany keeps the seed fast; rows are inserted in array order, so ids climb
  // with createdAt.
  await client.ledgerEntry.createMany({ data: rows });
}

export async function seed(client: PrismaClient = prisma): Promise<void> {
  for (const p of PRODUCTS) {
    await client.product.upsert({
      where: { id: p.id },
      create: p,
      update: { name: p.name, unitPrice: p.unitPrice },
    });
  }
  for (const c of CUSTOMERS) {
    await client.customer.upsert({
      where: { id: c.id },
      create: c,
      update: { name: c.name, balance: c.balance },
    });
  }
  await seedHeavyHistory(client);
  // eslint-disable-next-line no-console
  console.log(
    `Seeded ${PRODUCTS.length} products and ${CUSTOMERS.length} customers ` +
      `(${HEAVY_EVENT_COUNT} usage events for ${HEAVY_CUSTOMER_ID}; idempotent).`,
  );
}

// Run directly (prisma db seed / npm run seed).
if (require.main === module) {
  seed()
    .then(() => prisma.$disconnect())
    .catch(async (err) => {
      // eslint-disable-next-line no-console
      console.error(err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
