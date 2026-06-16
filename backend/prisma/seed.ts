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

export async function seed(client: PrismaClient = prisma): Promise<void> {
  for (const p of PRODUCTS) {
    await client.product.upsert({
      where: { id: p.id },
      create: p,
      update: { name: p.name, unitPrice: p.unitPrice },
    });
  }
  // eslint-disable-next-line no-console
  console.log(`Seeded ${PRODUCTS.length} products (idempotent).`);
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
