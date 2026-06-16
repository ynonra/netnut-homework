import { Router } from "express";
import { customerService, CustomerNotFoundError } from "../services/customer.service";

export const customersRouter = Router();

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
