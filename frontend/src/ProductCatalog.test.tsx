import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { ProductCatalog } from "./ProductCatalog";
import { renderWithClient } from "./testUtils";
import type { Product } from "./api";

/**
 * Component tests for the product catalog (issue #1): prices stored as integer
 * minor units are rendered as currency, and a fetch failure shows an error rather
 * than a blank table.
 */
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  fetchProducts: vi.fn(),
}));

import { fetchProducts } from "./api";

const product = (over: Partial<Product>): Product => ({
  id: "p_x",
  name: "Widget",
  unitPrice: 250,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ProductCatalog", () => {
  it("renders products with prices formatted from minor units", async () => {
    vi.mocked(fetchProducts).mockResolvedValue([
      product({ id: "p_a", name: "Alpha", unitPrice: 250 }),
      product({ id: "p_b", name: "Beta", unitPrice: 12345 }),
    ]);

    renderWithClient(<ProductCatalog />);

    expect(await screen.findByText("Alpha")).toBeDefined();
    expect(screen.getByText("$2.50")).toBeDefined();
    expect(screen.getByText("$123.45")).toBeDefined();
  });

  it("shows an error state when the catalog fails to load", async () => {
    vi.mocked(fetchProducts).mockRejectedValue(new Error("boom"));

    renderWithClient(<ProductCatalog />);

    await waitFor(() =>
      expect(screen.getByText(/Failed to load products: boom/)).toBeDefined(),
    );
  });
});
