import { FormEvent, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  consume,
  fetchCustomers,
  fetchProducts,
  formatCredits,
  InsufficientFundsError,
  LedgerEntry,
} from "./api";

/**
 * Consume-a-product form (US-C, issue #3): select a Customer and Product, enter a
 * Quantity, and POST a Consumption Event. Success and insufficient-funds (402) are
 * surfaced distinctly.
 *
 * On success it invalidates the customers query so the balance list refetches and
 * converges to DB truth (docs/adr/0003).
 */
export function ConsumeForm() {
  const queryClient = useQueryClient();
  const customers = useQuery({ queryKey: ["customers"], queryFn: fetchCustomers });
  const products = useQuery({ queryKey: ["products"], queryFn: fetchProducts });

  const [customerId, setCustomerId] = useState("");
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("1");

  // The idempotency key for the current submission (docs/adr/0002). Minted once
  // per submit in onSubmit and held in a ref so React Query's retries reuse it —
  // guaranteeing a retried POST is charged exactly once. A fresh submission mints
  // a new key, so it is a deliberate second action, not a replay.
  const idempotencyKey = useRef<string>("");

  const mutation = useMutation<LedgerEntry, Error, void>({
    mutationFn: () =>
      consume(
        { customerId, productId, quantity: Number(quantity) },
        idempotencyKey.current,
      ),
    // Retry only transient failures (e.g. a lost response), up to 2 times. Retries
    // reuse the same mutationFn closure — hence the same idempotency key in the ref
    // — so a retried submission is deduped server-side to a single charge (ADR
    // 0002). Insufficient funds (402) is a deterministic business rejection:
    // retrying cannot change it and would only delay the message, so surface it
    // immediately rather than after 3 attempts.
    retry: (failureCount, error) =>
      !(error instanceof InsufficientFundsError) && failureCount < 2,
    onSuccess: () => {
      // Refetch balances so the dashboard reflects the deduction immediately.
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
    },
  });

  const quantityNum = Number(quantity);
  const quantityValid =
    Number.isInteger(quantityNum) && quantityNum > 0 && quantity.trim() !== "";
  const canSubmit =
    customerId !== "" && productId !== "" && quantityValid && !mutation.isPending;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    // Mint a fresh key per submission (docs/adr/0002); retries of this submission
    // reuse it, a new submission gets a new one.
    idempotencyKey.current = crypto.randomUUID();
    mutation.mutate();
  }

  return (
    <form className="consume" onSubmit={onSubmit}>
      <div className="consume__row">
        <label className="consume__field">
          <span>Customer</span>
          <select
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            disabled={customers.isLoading}
          >
            <option value="">Select customer…</option>
            {customers.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({formatCredits(c.balance)})
              </option>
            ))}
          </select>
        </label>

        <label className="consume__field">
          <span>Product</span>
          <select
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            disabled={products.isLoading}
          >
            <option value="">Select product…</option>
            {products.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({formatCredits(p.unitPrice)}/unit)
              </option>
            ))}
          </select>
        </label>

        <label className="consume__field consume__field--qty">
          <span>Quantity</span>
          <input
            type="number"
            min={1}
            step={1}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </label>

        <button type="submit" disabled={!canSubmit} className="consume__submit">
          {mutation.isPending ? "Consuming…" : "Consume"}
        </button>
      </div>

      {!quantityValid && quantity.trim() !== "" && (
        <p className="consume__msg consume__msg--error">
          Quantity must be a positive whole number.
        </p>
      )}

      <Result mutation={mutation} />
    </form>
  );
}

function Result({
  mutation,
}: {
  mutation: ReturnType<typeof useMutation<LedgerEntry, Error, void>>;
}) {
  if (mutation.isSuccess) {
    const cost = -mutation.data.amount;
    return (
      <p className="consume__msg consume__msg--ok" role="status">
        Charged {formatCredits(cost)} — consumption recorded.
      </p>
    );
  }

  if (mutation.isError) {
    const err = mutation.error;
    if (err instanceof InsufficientFundsError) {
      return (
        <p className="consume__msg consume__msg--denied" role="alert">
          Insufficient funds: balance {formatCredits(err.balance)}, need{" "}
          {formatCredits(err.required)}.
        </p>
      );
    }
    return (
      <p className="consume__msg consume__msg--error" role="alert">
        {err.message}
      </p>
    );
  }

  return null;
}
