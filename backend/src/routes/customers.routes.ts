import { Router } from "express";
import { customerService, CustomerNotFoundError } from "../services/customer.service";
import { prisma } from "../db/prisma";

export const customersRouter = Router();

/** Default and maximum page size for the Usage history (docs/adr/0004). */
const DEFAULT_USAGE_LIMIT = 25;
const MAX_USAGE_LIMIT = 100;

/**
 * GET /customers — return all customers with their current balance as JSON.
 *
 * balance is returned in integer minor units; the client formats it for display
 * and decides the low/depleted indicator from the raw integer.
 */
customersRouter.get("/customers", async (_req, res, next) => {
  try {
    const customers = await customerService.listCustomers();
    res.json({ data: customers });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /customers/:id/usage-events?cursor=&limit=
 *
 * Newest-first, cursor-paginated Usage history (US-B): every LedgerEntry for the
 * Customer — CONSUMPTION and CREDIT rows alike. Paginated on the monotonic Int id
 * (docs/adr/0004), never OFFSET, so it stays cheap and correct as the ledger grows
 * and under timestamp collisions.
 *
 *   200 — { data: [...newest-first], nextCursor: number | null }.
 *         nextCursor is the cursor to request the next (older) page; null on the
 *         last page. An empty `data` with a known customer is a valid empty history.
 *   400 — malformed cursor or limit query parameter.
 *   404 — unknown customer (distinct from an empty history).
 */
customersRouter.get("/customers/:id/usage-events", async (req, res, next) => {
  try {
    const customerId = req.params.id;

    // Parse and validate the limit. Absent → default; otherwise a positive integer
    // clamped to MAX_USAGE_LIMIT so a client can never demand an unbounded page.
    let limit = DEFAULT_USAGE_LIMIT;
    if (req.query.limit !== undefined) {
      const parsed = Number(req.query.limit);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        res.status(400).json({
          error: "invalid_request",
          message: "limit must be a positive integer",
        });
        return;
      }
      limit = Math.min(parsed, MAX_USAGE_LIMIT);
    }

    // Parse and validate the cursor (the Int id of the previous page's last row).
    let cursor: number | undefined;
    if (req.query.cursor !== undefined) {
      const parsed = Number(req.query.cursor);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        res.status(400).json({
          error: "invalid_request",
          message: "cursor must be a positive integer",
        });
        return;
      }
      cursor = parsed;
    }

    // Verify the customer exists so a 404 is not masked as an empty history.
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true },
    });
    if (!customer) {
      res.status(404).json({
        error: "not_found",
        message: `Customer not found: ${customerId}`,
      });
      return;
    }

    const page = await customerService.listUsageEvents({ customerId, cursor, limit });
    res.json(page);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /customers/:id/credits { amount }
 *
 * Credit the Wallet (Top-up, US-B): atomically increment the Balance by `amount`
 * (Prisma `increment`, docs/adr/0001) and write a CREDIT LedgerEntry in the same
 * transaction. The created ledger row is returned; the client refetches the
 * customer list so the balance reflects the top-up immediately.
 *
 *   201 — credited; returns the created CREDIT ledger entry.
 *   400 — invalid input (amount not a positive integer in minor units).
 *   404 — unknown customer.
 */
customersRouter.post("/customers/:id/credits", async (req, res, next) => {
  try {
    const customerId = req.params.id;
    const { amount } = req.body ?? {};

    // Input validation at the route boundary. amount must be a positive integer
    // in minor units (no floats, no zero, no negatives) — a top-up only ever
    // adds Credits.
    if (
      typeof amount !== "number" ||
      !Number.isInteger(amount) ||
      amount <= 0
    ) {
      res.status(400).json({
        error: "invalid_request",
        message: "amount must be a positive integer (minor units)",
      });
      return;
    }

    const entry = await customerService.creditWallet({ customerId, amount });
    res.status(201).json({ data: entry });
  } catch (err) {
    if (err instanceof CustomerNotFoundError) {
      res.status(404).json({ error: "not_found", message: err.message });
      return;
    }
    next(err);
  }
});
