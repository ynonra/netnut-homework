// Load test for the "thousands of consumptions per minute" requirement.
//
// Fires COUNT consumption events at one customer through the API (the nginx proxy
// in the multi-instance setup, so requests fan out across backend instances on a
// shared SQLite file), while a separate reader loop polls the dashboard's
// GET /customers endpoint the whole time. It then proves two things:
//
//   1. Consistency  — the final balance dropped by EXACTLY (successes × cost),
//      i.e. no lost updates and no overspend under concurrency (docs/adr/0001).
//   2. Liveness     — the dashboard read stayed fast and 200 throughout the write
//      storm (WAL: readers don't block writers, docs/adr/0003).
//
// Usage:  node scripts/load-test.mjs
//   env:  API=http://localhost:4000  COUNT=3000  CONCURRENCY=40  QTY=1
//
// The customer is auto-topped-up first so every consume can succeed and we measure
// throughput rather than rejections.

const API = process.env.API ?? "http://localhost:4000";
const COUNT = Number(process.env.COUNT ?? 3000);
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 40);
const QTY = Number(process.env.QTY ?? 1);

const ms = (n) => `${n.toFixed(0)}ms`;
const pct = (arr, p) => {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

async function getJson(path) {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return res.json();
}

async function main() {
  console.log(`API=${API}  COUNT=${COUNT}  CONCURRENCY=${CONCURRENCY}  QTY=${QTY}\n`);

  // Pick a customer and the cheapest product (to keep the top-up small).
  const customers = (await getJson("/customers")).data;
  const products = (await getJson("/products")).data;
  const customer = customers[0];
  const product = [...products].sort((a, b) => a.unitPrice - b.unitPrice)[0];
  const cost = product.unitPrice * QTY;

  // Top up enough to afford every consume, so all should succeed.
  const need = COUNT * cost + 1000;
  await fetch(`${API}/customers/${customer.id}/credits`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount: need }),
  });

  const before = (await getJson("/customers")).data.find((c) => c.id === customer.id)
    .balance;
  console.log(
    `customer=${customer.name} (${customer.id})  product=${product.name}  cost=${cost}/event`,
  );
  console.log(`balance after top-up = ${before}\n`);

  // Reader loop: poll the dashboard endpoint the whole time the writes run.
  let reading = true;
  const readLatencies = [];
  let readOk = 0;
  let readBad = 0;
  const reader = (async () => {
    while (reading) {
      const t = performance.now();
      try {
        const res = await fetch(`${API}/customers`);
        readLatencies.push(performance.now() - t);
        res.ok ? readOk++ : readBad++;
      } catch {
        readBad++;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
  })();

  // Write storm: COUNT consumes with a bounded worker pool. No idempotency key —
  // each is a distinct real event.
  const status = { ok: 0, insufficient: 0, error: 0 };
  let next = 0;
  const t0 = performance.now();
  async function worker() {
    while (next < COUNT) {
      next++;
      try {
        const res = await fetch(`${API}/consumption-events`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            customerId: customer.id,
            productId: product.id,
            quantity: QTY,
          }),
        });
        if (res.status === 201) status.ok++;
        else if (res.status === 402) status.insufficient++;
        else status.error++;
      } catch {
        status.error++;
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const elapsed = (performance.now() - t0) / 1000;

  reading = false;
  await reader;

  const after = (await getJson("/customers")).data.find((c) => c.id === customer.id)
    .balance;
  const expectedDelta = status.ok * cost;
  const actualDelta = before - after;

  console.log("── WRITE STORM ──────────────────────────────");
  console.log(`sent:            ${COUNT}`);
  console.log(`201 ok:          ${status.ok}`);
  console.log(`402 insufficient:${status.insufficient}`);
  console.log(`errors:          ${status.error}`);
  console.log(`elapsed:         ${elapsed.toFixed(1)}s`);
  console.log(`throughput:      ${(status.ok / elapsed).toFixed(0)} ok-consumes/sec  (${(status.ok / elapsed * 60).toFixed(0)}/min)`);

  console.log("\n── CONSISTENCY (docs/adr/0001) ──────────────");
  console.log(`balance:         ${before} -> ${after}`);
  console.log(`expected drop:   ${expectedDelta}  (${status.ok} ok × ${cost})`);
  console.log(`actual drop:     ${actualDelta}`);
  const consistent = expectedDelta === actualDelta && after >= 0;
  console.log(`result:          ${consistent ? "✅ EXACT — no lost updates, no overspend" : "❌ MISMATCH"}`);

  console.log("\n── DASHBOARD LIVENESS (docs/adr/0003) ───────");
  console.log(`reads during storm: ${readOk} ok, ${readBad} failed`);
  console.log(`read latency:    p50=${ms(pct(readLatencies, 50))}  p95=${ms(pct(readLatencies, 95))}  max=${ms(Math.max(...readLatencies))}`);
  const live = readBad === 0;
  console.log(`result:          ${live ? "✅ dashboard read stayed available throughout" : "⚠️ some reads failed"}`);

  process.exit(consistent && live ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
