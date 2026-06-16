import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { CreditForm } from "./CreditForm";
import { renderWithClient } from "./testUtils";
import type { Customer, LedgerEntry } from "./api";

/**
 * Component tests for the credit-the-wallet form (US-B). They pin: the current
 * balance is shown, the major-unit input is converted to integer minor units
 * (rejecting fractional cents and non-positive amounts before any POST), a
 * successful credit clears the field and confirms, and a missing customer reads
 * as not-found.
 */
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  fetchCustomers: vi.fn(),
  creditWallet: vi.fn(),
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

describe("CreditForm", () => {
  it("shows the current balance", async () => {
    renderWithClient(<CreditForm customerId="c1" />);
    expect(await screen.findByText(/Current balance:/)).toBeDefined();
    expect(screen.getByText("$10.00")).toBeDefined();
  });

  it("rejects fractional cents and non-positive amounts before posting", async () => {
    renderWithClient(<CreditForm customerId="c1" />);
    const input = await screen.findByLabelText("Top-up amount");
    const submit = () =>
      screen.getByRole("button", { name: /Credit wallet/ }) as HTMLButtonElement;

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

    renderWithClient(<CreditForm customerId="c1" />);
    const input = (await screen.findByLabelText("Top-up amount")) as HTMLInputElement;

    fireEvent.change(input, { target: { value: "5" } }); // $5.00 → 500 minor units
    fireEvent.click(screen.getByRole("button", { name: /Credit wallet/ }));

    await waitFor(() => expect(creditWallet).toHaveBeenCalledWith("c1", 500));
    expect(await screen.findByText(/Credited \$5\.00/)).toBeDefined();
    expect(input.value).toBe(""); // field reset on success
  });

  it("reads as not-found when the customer is absent", async () => {
    renderWithClient(<CreditForm customerId="missing" />);
    expect(await screen.findByText("Customer not found.")).toBeDefined();
  });
});
