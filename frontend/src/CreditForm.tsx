import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  creditWallet,
  fetchCustomers,
  formatCredits,
  LedgerEntry,
} from "./api";

/**
 * Credit-the-wallet (Top-up) form for one Customer (US-B). Extracted from the
 * detail view so "credit" is its own focused action/modal, distinct from viewing
 * details. On a successful top-up it invalidates the customers query (so the
 * balance refetches everywhere) and this customer's usage history (a CREDIT row
 * was appended) — docs/adr/0003.
 */
export function CreditForm({ customerId }: { customerId: string }) {
  const queryClient = useQueryClient();
  const customers = useQuery({ queryKey: ["customers"], queryFn: fetchCustomers });
  const customer = customers.data?.find((c) => c.id === customerId);

  // Amount entered in major units (e.g. dollars) for the operator's convenience;
  // converted to integer minor units before POSTing, matching the API contract.
  const [amount, setAmount] = useState("");

  const mutation = useMutation<LedgerEntry, Error, number>({
    mutationFn: (minorUnits: number) => creditWallet(customerId, minorUnits),
    onSuccess: () => {
      setAmount("");
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
      void queryClient.invalidateQueries({
        queryKey: ["usage-events", customerId],
      });
    },
  });

  // Parse the major-unit input into integer minor units. Valid only when it is a
  // finite, positive amount with at most two decimal places (no fractional cents).
  // The sub-cent check compares raw cents to the rounded value, so e.g. 1.234 is
  // rejected rather than silently rounded to 123 — matching the error message.
  const major = Number(amount);
  const cents = major * 100;
  const minorUnits = Math.round(cents);
  const amountValid =
    amount.trim() !== "" &&
    Number.isFinite(major) &&
    major > 0 &&
    Math.abs(cents - minorUnits) < 1e-9;
  const canSubmit = amountValid && !mutation.isPending;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    mutation.mutate(minorUnits);
  }

  if (customers.isLoading) {
    return <p className="state">Loading customer…</p>;
  }
  if (!customer) {
    return <p className="state state--error">Customer not found.</p>;
  }

  return (
    <form className="consume" onSubmit={onSubmit}>
      <p className="detail__balance">
        Current balance: <strong>{formatCredits(customer.balance)}</strong>
      </p>
      <div className="consume__row">
        <label className="consume__field consume__field--qty">
          <span>Top-up amount</span>
          <input
            type="number"
            min="0.01"
            step="0.01"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <button type="submit" disabled={!canSubmit} className="consume__submit">
          {mutation.isPending ? "Crediting…" : "Credit wallet"}
        </button>
      </div>

      {!amountValid && amount.trim() !== "" && (
        <p className="consume__msg consume__msg--error">
          Enter a positive amount with at most two decimal places.
        </p>
      )}

      {mutation.isSuccess && (
        <p className="consume__msg consume__msg--ok" role="status">
          Credited {formatCredits(mutation.data.amount)} — new balance{" "}
          {formatCredits(customer.balance)}.
        </p>
      )}
      {mutation.isError && (
        <p className="consume__msg consume__msg--error" role="alert">
          {mutation.error.message}
        </p>
      )}
    </form>
  );
}
