import { Router } from "express";
import {
  consumptionService,
  InsufficientFundsError,
  NotFoundError,
} from "../services/consumption.service";

export const consumptionRouter = Router();

/**
 * POST /consumption-events { customerId, productId, quantity }
 *
 * Records a Consumption Event: deducts `Cost = unitPrice × quantity` from the
 * Wallet Balance atomically, only if funds suffice (docs/adr/0001), and inserts
 * the LedgerEntry in the same transaction.
 *
 * Honors an optional `Idempotency-Key` header (docs/adr/0002): a replayed key
 * returns the original ledger row without a second deduction. Omitted → processed
 * normally with no dedup, so manual `curl` testing stays simple.
 *
 *   201 — charged; returns the created ledger entry.
 *   400 — invalid input (missing fields, non-positive / non-integer quantity).
 *   402 — insufficient funds: { error: "insufficient_funds", balance, required }.
 *   404 — unknown customer or product.
 */
consumptionRouter.post("/consumption-events", async (req, res, next) => {
  try {
    const { customerId, productId, quantity } = req.body ?? {};

    // Optional client-minted idempotency key (docs/adr/0002). Header names are
    // case-insensitive; Express lower-cases them. A header may arrive as an array
    // if sent twice — take the first. Absent or blank → no dedup.
    const rawKey = req.headers["idempotency-key"];
    const headerKey = Array.isArray(rawKey) ? rawKey[0] : rawKey;
    const idempotencyKey =
      typeof headerKey === "string" && headerKey.length > 0
        ? headerKey
        : undefined;

    // Input validation at the route boundary.
    if (typeof customerId !== "string" || customerId.length === 0) {
      res.status(400).json({ error: "invalid_request", message: "customerId is required" });
      return;
    }
    if (typeof productId !== "string" || productId.length === 0) {
      res.status(400).json({ error: "invalid_request", message: "productId is required" });
      return;
    }
    // Quantity must be a positive integer (no floats, no zero, no negatives).
    if (
      typeof quantity !== "number" ||
      !Number.isInteger(quantity) ||
      quantity <= 0
    ) {
      res.status(400).json({
        error: "invalid_request",
        message: "quantity must be a positive integer",
      });
      return;
    }

    const entry = await consumptionService.consume({
      customerId,
      productId,
      quantity,
      idempotencyKey,
    });
    res.status(201).json({ data: entry });
  } catch (err) {
    if (err instanceof InsufficientFundsError) {
      res.status(402).json({
        error: "insufficient_funds",
        balance: err.balance,
        required: err.required,
      });
      return;
    }
    if (err instanceof NotFoundError) {
      res.status(404).json({ error: "not_found", message: err.message });
      return;
    }
    next(err);
  }
});
