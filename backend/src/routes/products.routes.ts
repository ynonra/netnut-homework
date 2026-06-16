import { Router } from "express";
import { productService } from "../services/product.service";

export const productsRouter = Router();

/**
 * GET /products — return the product catalog as JSON.
 *
 * unitPrice is returned in integer minor units; the client is responsible for
 * formatting it for display.
 */
productsRouter.get("/products", async (_req, res, next) => {
  try {
    const products = await productService.listProducts();
    res.json({ data: products });
  } catch (err) {
    next(err);
  }
});
