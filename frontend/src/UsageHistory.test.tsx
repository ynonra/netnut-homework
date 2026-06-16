import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { UsageHistory } from "./UsageHistory";
import { renderWithClient } from "./testUtils";
import type { LedgerEntry } from "./api";

/**
 * Component tests for the cursor-paginated usage history (US-B, docs/adr/0004).
 * They pin: the empty-history state reads distinctly (not blank), CONSUMPTION and
 * CREDIT rows render with the right labels/amounts (quantity shown as — for a
 * credit), and the load-more control pages backwards using the previous page's
 * nextCursor and disappears on the last page.
 */
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  fetchUsageEvents: vi.fn(),
  fetchProducts: vi.fn(),
}));

import { fetchProducts, fetchUsageEvents } from "./api";

const entry = (over: Partial<LedgerEntry>): LedgerEntry => ({
  id: 1,
  customerId: "c1",
  type: "CONSUMPTION",
  productId: "p1",
  quantity: 3,
  unitPrice: 250,
  amount: -750,
  createdAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

beforeEach(() => {
  // The product column resolves productId -> name from the catalog.
  vi.mocked(fetchProducts).mockResolvedValue([
    {
      id: "p1",
      name: "Widget",
      unitPrice: 250,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("UsageHistory", () => {
  it("shows a distinct empty state when there is no usage", async () => {
    vi.mocked(fetchUsageEvents).mockResolvedValue({ data: [], nextCursor: null });

    renderWithClient(<UsageHistory customerId="c_empty" />);

    expect(await screen.findByText("No usage yet.")).toBeDefined();
    expect(screen.queryByText("Load more")).toBeNull();
  });

  it("renders consumption and credit rows with formatted amounts", async () => {
    vi.mocked(fetchUsageEvents).mockResolvedValue({
      data: [
        entry({ id: 12, type: "CONSUMPTION", quantity: 3, amount: -750 }),
        entry({ id: 8, type: "CREDIT", quantity: null, productId: null, amount: 500 }),
      ],
      nextCursor: null,
    });

    renderWithClient(<UsageHistory customerId="c1" />);

    expect(await screen.findByText("Consumed")).toBeDefined();
    expect(screen.getByText("Credited")).toBeDefined();
    // The consumption row resolves its productId to the product name.
    expect(screen.getByText("Widget")).toBeDefined();
    expect(screen.getByText("-$7.50")).toBeDefined();
    expect(screen.getByText("$5.00")).toBeDefined();
    // A credit has neither a product nor a quantity → both render as an em dash.
    expect(screen.getAllByText("—")).toHaveLength(2);
    // Last page (null cursor) → no load-more control.
    expect(screen.queryByText("Load more")).toBeNull();
  });

  it("pages backwards through older entries via the cursor, then hides load-more", async () => {
    vi.mocked(fetchUsageEvents)
      .mockResolvedValueOnce({ data: [entry({ id: 10, amount: -100 })], nextCursor: 10 })
      .mockResolvedValueOnce({ data: [entry({ id: 5, amount: -200 })], nextCursor: null });

    renderWithClient(<UsageHistory customerId="c1" />);

    // First (newest) page rendered with a load-more control.
    await screen.findByText("-$1.00");
    const more = await screen.findByText("Load more");

    fireEvent.click(more);

    // Older page appended; the second fetch used the first page's nextCursor.
    expect(await screen.findByText("-$2.00")).toBeDefined();
    await waitFor(() =>
      expect(fetchUsageEvents).toHaveBeenLastCalledWith("c1", 10, 25),
    );
    // No further pages → control gone.
    await waitFor(() => expect(screen.queryByText("Load more")).toBeNull());
  });
});
