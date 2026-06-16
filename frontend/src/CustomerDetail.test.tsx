import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { CustomerDetail } from "./CustomerDetail";
import { renderWithClient } from "./testUtils";
import type { Customer } from "./api";

/**
 * Component tests for the customer detail view (US-B). It is read-only now —
 * balance, status, and usage history; crediting is its own action (CreditForm).
 * UsageHistory is mocked to a placeholder so this file tests the detail surface in
 * isolation; the history itself is covered in UsageHistory.test.tsx.
 */
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  fetchCustomers: vi.fn(),
}));
vi.mock("./UsageHistory", () => ({
  UsageHistory: () => <div data-testid="usage-history" />,
}));

import { fetchCustomers } from "./api";

const customer: Customer = {
  id: "c1",
  name: "Acme",
  balance: 1000,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

beforeEach(() => {
  vi.mocked(fetchCustomers).mockResolvedValue([customer]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CustomerDetail", () => {
  it("shows the balance, status, and usage history for the selected customer", async () => {
    renderWithClient(<CustomerDetail customerId="c1" />);

    expect(await screen.findByText("Acme")).toBeDefined();
    expect(screen.getByText("$10.00")).toBeDefined();
    expect(screen.getByText("Healthy").getAttribute("data-status")).toBe("healthy");
    expect(screen.getByTestId("usage-history")).toBeDefined();
  });

  it("reads as not-found when the customer is absent", async () => {
    renderWithClient(<CustomerDetail customerId="missing" />);
    expect(await screen.findByText("Customer not found.")).toBeDefined();
  });
});
