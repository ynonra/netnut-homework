import { Router } from "express";
import { customerService } from "../services/customer.service";

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
