import { Customer, PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "../db/prisma";

/**
 * Customer reads. The customer list is small (~10 rows, docs/adr/0003), so a plain
 * findMany is fine — no pagination here (that is for the unbounded ledger).
 */
export class CustomerService {
  constructor(private readonly prisma: PrismaClient = defaultPrisma) {}

  /** List all customers with their current balance, ordered by name. */
  listCustomers(): Promise<Customer[]> {
    return this.prisma.customer.findMany({ orderBy: { name: "asc" } });
  }
}

export const customerService = new CustomerService();
