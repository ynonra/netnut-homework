import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  balanceStatus,
  creditWallet,
  fetchCustomers,
  formatCredits,
  LedgerEntry,
} from "./api";
import { UsageHistory } from "./UsageHistory";

const STATUS_LABEL: Record<string, string> = {
  depleted: "Depleted",
  low: "Low",
  healthy: "Healthy",
};

/**
 * Customer detail view (US-B): shows the selected Customer's current balance and a
 * credit-the-wallet form. On a successful top-up it invalidates the customers
 * query so the balance here and in the list refetch and reflect the credit
 * immediately (docs/adr/0003).
 *
 * The balance is read from the shared ["customers"] query (the same source the
 * list polls), so a top-up applied anywhere converges everywhere.
 */
export function CustomerDetail({ customerId }: { customerId: string }) {
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
      // Refetch balances so the detail and list reflect the top-up immediately.
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
      // A top-up appends a CREDIT row, so refetch this customer's history too.
      void queryClient.invalidateQueries({
        queryKey: ["usage-events", customerId],
      });
    },
  });

  // Parse the major-unit input into integer minor units. Valid only when it is a
  // finite, positive amount with at most two decimal places (no fractional cents).
  const major = Number(amount);
  const minorUnits = Math.round(major * 100);
  const amountValid =
    amount.trim() !== "" &&
    Number.isFinite(major) &&
    major > 0 &&
    Number.isInteger(minorUnits);
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

  const status = balanceStatus(customer.balance);

  return (
    <div className="detail">
      <div className="detail__head">
        <h3 className="detail__name">{customer.name}</h3>
        <span
          className={`badge badge--${status}`}
          data-status={status}
          aria-label={`Balance status: ${STATUS_LABEL[status]}`}
        >
          {STATUS_LABEL[status]}
        </span>
      </div>
      <p className="detail__balance">
        Balance: <strong>{formatCredits(customer.balance)}</strong>
      </p>

      <form className="consume" onSubmit={onSubmit}>
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

      <div className="detail__history">
        <h4 className="detail__history-title">Usage history</h4>
        <UsageHistory customerId={customerId} />
      </div>
    </div>
  );
}
