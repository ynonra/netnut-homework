import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import { customersRouter } from "./routes/customers.routes";
import { productsRouter } from "./routes/products.routes";

/**
 * Build the Express app. Kept separate from server bootstrap so tests can mount
 * it against a temp database without binding a port.
 */
export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use(productsRouter);
  app.use(customersRouter);

  // Shared error envelope. Later slices add a richer taxonomy (402/404/422).
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    // eslint-disable-next-line no-console
    console.error(err);
    const message = err instanceof Error ? err.message : "Internal Server Error";
    res.status(500).json({ error: { message } });
  });

  return app;
}
