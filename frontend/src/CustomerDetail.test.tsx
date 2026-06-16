import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { CustomerDetail } from "./CustomerDetail";
import { renderWithClient } from "./testUtils";
import type { Customer, LedgerEntry } from "./api";

/**
 * Component tests for the customer detail / credit-the-wallet view (US-B). They
 * pin: the balance + status render, the major-unit top-up input is converted to
 * integer minor units (rejecting fractional cents and non-positive amounts before
 * any POST), a successful credit clears the field and confirms, and a missing
 * customer reads as not-found rather than blank.
 *
 * UsageHistory is mocked to a trivial element so this file tests the detail/credit
 * surface in isolation; the history itself is covered in UsageHistory.test.tsx.
 */
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  fetchCustomers: vi.fn(),
  creditWallet: vi.fn(),
}));
vi.mock("./UsageHistory", () => ({
  UsageHistory: () => <div data-testid="usage-history" />,
}));

import { creditWallet, fetchCustomers } from "./api";

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
  it("shows the balance and status for the selected customer", async () => {
    renderWithClient(<CustomerDetail customerId="c1" />);

    expect(await screen.findByText("Acme")).toBeDefined();
    expect(screen.getByText("$10.00")).toBeDefined();
    expect(screen.getByText("Healthy").getAttribute("data-status")).toBe("healthy");
  });

  it("rejects fractional cents and non-positive amounts before posting", async () => {
    renderWithClient(<CustomerDetail customerId="c1" />);
    await screen.findByText("Acme");
    const input = screen.getByLabelText("Top-up amount");
    const submit = () => screen.getByRole("button", { name: /Credit wallet/ }) as HTMLButtonElement;

    fireEvent.change(input, { target: { value: "1.234" } }); // fractional cents
    expect(screen.getByText(/at most two decimal places/)).toBeDefined();
    expect(submit().disabled).toBe(true);

    fireEvent.change(input, { target: { value: "-5" } }); // non-positive
    expect(submit().disabled).toBe(true);

    fireEvent.change(input, { target: { value: "5" } }); // valid
    expect(submit().disabled).toBe(false);
    expect(creditWallet).not.toHaveBeenCalled();
  });

  it("credits the wallet in minor units, clears the field, and confirms", async () => {
    vi.mocked(creditWallet).mockResolvedValue({
      id: 9,
      customerId: "c1",
      type: "CREDIT",
      productId: null,
      quantity: null,
      unitPrice: null,
      amount: 500,
      createdAt: "2026-01-02T00:00:00.000Z",
    } satisfies LedgerEntry);

    renderWithClient(<CustomerDetail customerId="c1" />);
    await screen.findByText("Acme");
    const input = screen.getByLabelText("Top-up amount") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "5" } }); // $5.00 → 500 minor units
    fireEvent.click(screen.getByRole("button", { name: /Credit wallet/ }));

    await waitFor(() => expect(creditWallet).toHaveBeenCalledWith("c1", 500));
    expect(await screen.findByText(/Credited \$5\.00/)).toBeDefined();
    expect(input.value).toBe(""); // field reset on success
  });

  it("reads as not-found when the customer is absent", async () => {
    renderWithClient(<CustomerDetail customerId="missing" />);
    expect(await screen.findByText("Customer not found.")).toBeDefined();
  });
});
