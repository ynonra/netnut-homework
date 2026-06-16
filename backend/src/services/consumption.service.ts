import { LedgerEntry, PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "../db/prisma";

/**
 * Raised when a Consumption Event cannot be charged because the Wallet lacks
 * sufficient Credits. Carries the current balance and the required cost so the
 * route can return the structured 402 body (issue #3).
 */
export class InsufficientFundsError extends Error {
  constructor(
    readonly balance: number,
    readonly required: number,
  ) {
    super("insufficient_funds");
    this.name = "InsufficientFundsError";
  }
}

/** Raised when the referenced Customer or Product does not exist (404). */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export interface ConsumeInput {
  customerId: string;
  productId: string;
  quantity: number;
}

/**
 * The core consume flow (docs/adr/0001). A Consumption Event deducts
 * `Cost = unitPrice × quantity` from the Wallet Balance, but only if funds
 * suffice, and never lets the Balance go negative.
 *
 * Correctness comes entirely from the atomic conditional UPDATE — the
 * `balance >= cost` check lives inside the WHERE clause, evaluated under SQLite's
 * write lock against the latest committed row. There is no read-then-write and no
 * application-memory check, so there is no race window. `count === 1` means the
 * deduction succeeded; `count === 0` means insufficient funds.
 *
 * The deduction and the append-only LedgerEntry insert run in a single
 * `$transaction`, so they commit or roll back together.
 */
export class ConsumptionService {
  constructor(private readonly prisma: PrismaClient = defaultPrisma) {}

  async consume(input: ConsumeInput): Promise<LedgerEntry> {
    const { customerId, productId, quantity } = input;

    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });
    if (!product) {
      throw new NotFoundError(`Product not found: ${productId}`);
    }

    const cost = product.unitPrice * quantity;

    return this.prisma.$transaction(
      async (tx) => {
        // Atomic conditional deduction (docs/adr/0001). The funds check is in the
        // WHERE clause — never read-then-write. updateMany is the only Prisma
        // method that carries a non-unique condition and reports rows affected.
        const { count } = await tx.customer.updateMany({
          where: { id: customerId, balance: { gte: cost } },
          data: { balance: { decrement: cost } },
        });

        if (count === 0) {
          // Either the customer does not exist or funds are insufficient.
          // Disambiguate with a single read; this read does NOT gate the
          // deduction (which already failed safely), so it introduces no race.
          const customer = await tx.customer.findUnique({
            where: { id: customerId },
          });
          if (!customer) {
            throw new NotFoundError(`Customer not found: ${customerId}`);
          }
          throw new InsufficientFundsError(customer.balance, cost);
        }

        // Append-only ledger row, same transaction as the deduction. amount is
        // the signed balance change: negative for a consumption.
        return tx.ledgerEntry.create({
          data: {
            customerId,
            type: "CONSUMPTION",
            productId,
            quantity,
            unitPrice: product.unitPrice,
            amount: -cost,
          },
        });
      },
      // SQLite has a single database-wide write lock (docs/adr/0001), so under a
      // burst these interactive transactions serialize and queue. Give queued
      // transactions room to wait for the lock and to run, rather than expiring
      // them — "contending writers queue instead of erroring" (ADR 0001). The
      // work inside is tiny (one indexed update + one insert); the elapsed time
      // is lock-wait, not compute.
      { maxWait: 30000, timeout: 30000 },
    );
  }
}

export const consumptionService = new ConsumptionService();
