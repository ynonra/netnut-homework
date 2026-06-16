import { Customer, LedgerEntry, PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "../db/prisma";

/** Raised when the referenced Customer does not exist (404). */
export class CustomerNotFoundError extends Error {
  constructor(readonly customerId: string) {
    super(`Customer not found: ${customerId}`);
    this.name = "CustomerNotFoundError";
  }
}

export interface CreditInput {
  customerId: string;
  /** Top-up amount in integer minor units — must be a positive integer. */
  amount: number;
}

/**
 * Customer reads and Wallet top-ups. The customer list is small (~10 rows,
 * docs/adr/0003), so a plain findMany is fine — no pagination here (that is for
 * the unbounded ledger).
 */
export class CustomerService {
  constructor(private readonly prisma: PrismaClient = defaultPrisma) {}

  /** List all customers with their current balance, ordered by name. */
  listCustomers(): Promise<Customer[]> {
    return this.prisma.customer.findMany({ orderBy: { name: "asc" } });
  }

  /**
   * Credit the Wallet (Top-up, US-B): increase the Balance by `amount` and append
   * a CREDIT LedgerEntry in one transaction, so the Balance stays consistent with
   * the ledger (CONTEXT.md "Usage Event").
   *
   * The increment is atomic, mirroring the consume deduction (docs/adr/0001): the
   * `increment` is evaluated under SQLite's write lock against the latest committed
   * row, never read-then-write. Concurrent credits and consumes on the same Wallet
   * therefore stay consistent — each is a single atomic delta. Unlike the consume
   * deduction there is no conditional guard: a top-up only ever raises the Balance,
   * so it can never breach the no-negative invariant and needs no `where` check
   * beyond the row's existence.
   *
   * Returns the created CREDIT ledger row. `amount` is validated at the route
   * boundary as a positive integer; callers must not pass a non-positive value.
   */
  async creditWallet(input: CreditInput): Promise<LedgerEntry> {
    const { customerId, amount } = input;

    return this.prisma.$transaction(async (tx) => {
      // Atomic increment, scoped to the customer id. updateMany reports rows
      // affected, so count === 0 disambiguates a missing customer without a
      // preceding read.
      const { count } = await tx.customer.updateMany({
        where: { id: customerId },
        data: { balance: { increment: amount } },
      });

      if (count === 0) {
        throw new CustomerNotFoundError(customerId);
      }

      // Append-only CREDIT ledger row, same transaction as the increment. amount
      // is the signed balance change: positive for a top-up. Product fields are
      // null because a top-up is not tied to a Product.
      return tx.ledgerEntry.create({
        data: {
          customerId,
          type: "CREDIT",
          amount,
        },
      });
    });
  }
}

export const customerService = new CustomerService();
