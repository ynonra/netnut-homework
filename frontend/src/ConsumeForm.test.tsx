import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { ConsumeForm } from "./ConsumeForm";
import { renderWithClient } from "./testUtils";
import type { Customer, LedgerEntry, Product } from "./api";

/**
 * Component tests for the consume-a-product form (US-C, issues #3/#2). These pin
 * the user-facing contract: quantity validation gates submission, a success shows
 * the charge, a 402 surfaces insufficient funds distinctly, and — the ADR 0002
 * client guarantee — every retry of one submission reuses the same minted
 * idempotency key so a retried POST is charged once.
 *
 * consume is mocked; InsufficientFundsError and formatCredits are the real ones
 * (spread from the original module) so the rendered messages reflect real format.
 */
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  fetchCustomers: vi.fn(),
  fetchProducts: vi.fn(),
  consume: vi.fn(),
}));

import { consume, InsufficientFundsError, fetchCustomers, fetchProducts } from "./api";

const UUID = "11111111-1111-4111-8111-111111111111";

const customers: Customer[] = [
  {
    id: "c1",
    name: "Acme",
    balance: 250,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];
const products: Product[] = [
  {
    id: "p1",
    name: "Widget",
    unitPrice: 250,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

beforeEach(() => {
  vi.mocked(fetchCustomers).mockResolvedValue(customers);
  vi.mocked(fetchProducts).mockResolvedValue(products);
  vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(UUID);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

async function selectCustomerAndProduct() {
  // Wait for the option lists to load, then pick one of each.
  await screen.findByRole("option", { name: /Acme/ });
  fireEvent.change(screen.getByLabelText("Customer"), { target: { value: "c1" } });
  fireEvent.change(screen.getByLabelText("Product"), { target: { value: "p1" } });
}

describe("ConsumeForm", () => {
  it("blocks submission until a customer, product, and positive integer quantity are set", async () => {
    renderWithClient(<ConsumeForm />);
    const submit = () => screen.getByRole("button", { name: /Consume/ });

    // Nothing selected yet → disabled.
    expect((submit() as HTMLButtonElement).disabled).toBe(true);

    await selectCustomerAndProduct();
    // Quantity defaults to "1" → now valid.
    expect((submit() as HTMLButtonElement).disabled).toBe(false);

    // A non-positive / non-integer quantity is rejected with a message.
    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "0" } });
    expect(screen.getByText(/Quantity must be a positive whole number/)).toBeDefined();
    expect((submit() as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "1.5" } });
    expect((submit() as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "3" } });
    expect((submit() as HTMLButtonElement).disabled).toBe(false);
  });

  it("posts the consumption with a minted idempotency key and shows the charge", async () => {
    vi.mocked(consume).mockResolvedValue({
      id: 1,
      customerId: "c1",
      type: "CONSUMPTION",
      productId: "p1",
      quantity: 3,
      unitPrice: 250,
      amount: -750,
      createdAt: "2026-01-01T00:00:00.000Z",
    } satisfies LedgerEntry);

    renderWithClient(<ConsumeForm />);
    await selectCustomerAndProduct();
    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: /Consume/ }));

    expect(await screen.findByText(/Charged \$7\.50 — consumption recorded/)).toBeDefined();
    expect(consume).toHaveBeenCalledWith(
      { customerId: "c1", productId: "p1", quantity: 3 },
      UUID,
    );

    // Form resets for the next entry: product and quantity cleared, customer kept.
    await waitFor(() =>
      expect((screen.getByLabelText("Product") as HTMLSelectElement).value).toBe(""),
    );
    expect((screen.getByLabelText("Quantity") as HTMLInputElement).value).toBe("1");
    expect((screen.getByLabelText("Customer") as HTMLSelectElement).value).toBe("c1");
  });

  it("surfaces 402 insufficient funds immediately, without retrying", async () => {
    vi.mocked(consume).mockRejectedValue(new InsufficientFundsError(250, 750));

    renderWithClient(<ConsumeForm />);
    await selectCustomerAndProduct();
    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: /Consume/ }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/Insufficient funds: balance \$2\.50, need \$7\.50/);

    // A 402 is a deterministic business rejection — retrying cannot change it and
    // would only delay the message, so the form must NOT retry: exactly one call.
    expect(consume).toHaveBeenCalledTimes(1);
  });

  it("retries a transient failure and reuses the same idempotency key each attempt", async () => {
    // A non-402 (e.g. a lost response) is retryable; retry: 2 → up to 3 attempts.
    vi.mocked(consume).mockRejectedValue(new Error("network blip"));

    renderWithClient(<ConsumeForm />);
    await selectCustomerAndProduct();
    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: /Consume/ }));

    // Every attempt reuses the one key minted for this submission (ADR 0002), so a
    // retried POST that did reach the server dedups server-side to a single charge.
    await waitFor(() => expect(consume).toHaveBeenCalledTimes(3));
    const keys = vi.mocked(consume).mock.calls.map((c) => c[1]);
    expect(keys).toEqual([UUID, UUID, UUID]);
    expect((await screen.findByRole("alert")).textContent).toMatch(/network blip/);
  });

  it("shows the customer as static text — no selector — when opened for a specific customer", async () => {
    renderWithClient(<ConsumeForm customerId="c1" />);

    // The fixed customer is shown for context, not as a dropdown.
    expect(await screen.findByText(/Acme \(\$2\.50\)/)).toBeDefined();
    // No customer control remains; the only combobox is the product select.
    expect(screen.queryByLabelText("Customer")).toBeNull();
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
  });
});
