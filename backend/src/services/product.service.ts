import { PrismaClient, Product } from "@prisma/client";
import { prisma as defaultPrisma } from "../db/prisma";

/**
 * Product catalog reads. The catalog is small and read-mostly.
 */
export class ProductService {
  constructor(private readonly prisma: PrismaClient = defaultPrisma) {}

  /** List the full product catalog, ordered by name for a stable display. */
  listProducts(): Promise<Product[]> {
    return this.prisma.product.findMany({ orderBy: { name: "asc" } });
  }
}

export const productService = new ProductService();
