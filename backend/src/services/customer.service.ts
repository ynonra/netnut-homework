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

export interface UsageEventsInput {
  customerId: string;
  /**
   * Opaque cursor: the `Int` id of the last row of the previous page. The next
   * page starts strictly *before* it (older id). Omitted → first (newest) page.
   */
  cursor?: number;
  /** Page size. Clamped to a sane range at the route boundary. */
  limit: number;
}

export interface UsageEventsPage {
  data: LedgerEntry[];
  /**
   * Cursor to pass back for the next (older) page, or null when this is the last
   * page. It is the `Int` id of the last returned row.
   */
  nextCursor: number | null;
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
   * Newest-first, cursor-paginated Usage history for one Customer (US-B). Returns
   * every LedgerEntry — both CONSUMPTION and CREDIT rows — for audit and history.
   *
   * Pagination is keyed on the monotonic autoincrement `Int` id, never OFFSET
   * (docs/adr/0004). The id is monotonic, so ordering by id DESC is the same
   * newest-first order as createdAt but with a stable, unique tiebreaker: under the
   * write storm many rows share a `createdAt`, and a createdAt-only cursor would
   * skip or duplicate rows at page boundaries — the id never collides.
   *
   * Prisma's `cursor` + `skip: 1` compiles to a seek (`WHERE id < cursor ORDER BY
   * id DESC LIMIT n`), one index range scan per page, no OFFSET re-count. We fetch
   * `limit + 1` rows to detect whether a further page exists without a second
   * query, then trim the probe row and expose its predecessor's id as nextCursor.
   *
   * The customer's existence is verified by the route before calling this (a
   * 404 must not look like an empty history).
   */
  async listUsageEvents(input: UsageEventsInput): Promise<UsageEventsPage> {
    const { customerId, cursor, limit } = input;

    const rows = await this.prisma.ledgerEntry.findMany({
      where: { customerId },
      orderBy: { id: "desc" },
      take: limit + 1,
      ...(cursor !== undefined
        ? { cursor: { id: cursor }, skip: 1 }
        : {}),
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? page[page.length - 1].id : null;

    return { data: page, nextCursor };
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
