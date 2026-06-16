import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { App } from "./App";
import { renderWithClient } from "./testUtils";
import type { Customer, Product } from "./api";

/**
 * Integration tests for the dashboard shell: the consume and credit/detail
 * surfaces live in a modal opened from a customer row's action buttons, not inline
 * in the page. ./api is mocked so the real list + modal wiring is exercised.
 */
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  fetchCustomers: vi.fn(),
  fetchProducts: vi.fn(),
  fetchUsageEvents: vi.fn(),
}));

import { fetchCustomers, fetchProducts, fetchUsageEvents } from "./api";

const customer: Customer = {
  id: "c1",
  name: "Acme",
  balance: 1000,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
const product: Product = {
  id: "p1",
  name: "Widget",
  unitPrice: 250,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

beforeEach(() => {
  vi.mocked(fetchCustomers).mockResolvedValue([customer]);
  vi.mocked(fetchProducts).mockResolvedValue([product]);
  vi.mocked(fetchUsageEvents).mockResolvedValue({ data: [], nextCursor: null });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("App dashboard shell", () => {
  it("opens no modal until a row action is used", async () => {
    renderWithClient(<App />);
    await screen.findByText("Acme");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens the consume modal for the row's customer (shown as fixed context), and closes it", async () => {
    renderWithClient(<App />);

    const consumeBtn = await screen.findByRole("button", {
      name: "Consume a product: Acme",
    });
    fireEvent.click(consumeBtn);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Consume a product")).toBeDefined(); // modal title
    // The customer is shown as fixed context inside the dialog, not as a selector.
    await waitFor(() => expect(within(dialog).getByText(/Acme/)).toBeDefined());
    expect(within(dialog).queryByLabelText("Customer")).toBeNull();

    fireEvent.click(screen.getByLabelText("Close"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("opens the credit modal from the row action", async () => {
    renderWithClient(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Credit wallet: Acme" }));

    await screen.findByRole("dialog");
    expect(screen.getByText(/Current balance:/)).toBeDefined();
    // Exact name → the modal's submit button, not the row's "Credit wallet: Acme" icon.
    expect(screen.getByRole("button", { name: "Credit wallet" })).toBeDefined();
  });
});
