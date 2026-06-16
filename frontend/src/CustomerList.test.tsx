import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { CustomerList } from "./CustomerList";
import { renderWithClient } from "./testUtils";
import type { Customer } from "./api";

/**
 * Component tests for the customer list (US-A): the balance is formatted as
 * currency and each row shows the right low/depleted indicator, selection is
 * reported to the parent, and load/error states render distinctly. ./api is
 * mocked so these assert presentation only; balanceStatus/formatCredits stay real
 * (they encode the actual thresholds the indicator is judged on).
 */
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  fetchCustomers: vi.fn(),
}));

import { fetchCustomers } from "./api";

const customer = (over: Partial<Customer>): Customer => ({
  id: "c_x",
  name: "Acme",
  balance: 10000,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CustomerList", () => {
  it("renders each balance as currency with the right status indicator", async () => {
    vi.mocked(fetchCustomers).mockResolvedValue([
      customer({ id: "c_depleted", name: "Depleted Inc", balance: 0 }),
      customer({ id: "c_low", name: "Low Co", balance: 300 }),
      customer({ id: "c_healthy", name: "Healthy LLC", balance: 10000 }),
    ]);

    renderWithClient(<CustomerList />);

    expect(await screen.findByText("Depleted Inc")).toBeDefined();
    // Balances formatted from integer minor units (cents) to currency.
    expect(screen.getByText("$0.00")).toBeDefined();
    expect(screen.getByText("$3.00")).toBeDefined();
    expect(screen.getByText("$100.00")).toBeDefined();

    // The indicator classifies depleted (0), low (<= $5), healthy via data-status.
    // Query the badges by aria-label so the <td> wrappers aren't matched too.
    const statuses = screen
      .getAllByLabelText(/Balance status:/)
      .map((el) => el.getAttribute("data-status"));
    expect(statuses).toEqual(["depleted", "low", "healthy"]);
  });

  it("reports the clicked customer to the parent and marks it selected", async () => {
    vi.mocked(fetchCustomers).mockResolvedValue([
      customer({ id: "c_low", name: "Low Co", balance: 300 }),
    ]);
    const onSelect = vi.fn();

    renderWithClient(<CustomerList selectedId="c_low" onSelect={onSelect} />);

    const row = (await screen.findByText("Low Co")).closest("tr")!;
    expect(row.getAttribute("aria-selected")).toBe("true");

    fireEvent.click(row);
    expect(onSelect).toHaveBeenCalledWith("c_low");
  });

  it("surfaces a load failure instead of rendering an empty table", async () => {
    vi.mocked(fetchCustomers).mockRejectedValue(new Error("network down"));

    renderWithClient(<CustomerList />);

    await waitFor(() =>
      expect(screen.getByText(/Failed to load customers: network down/)).toBeDefined(),
    );
    expect(screen.queryByRole("table")).toBeNull();
  });
});
