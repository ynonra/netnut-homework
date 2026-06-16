import { useQuery } from "@tanstack/react-query";
import { balanceStatus, fetchCustomers, formatCredits } from "./api";
import { UsageHistory } from "./UsageHistory";

const STATUS_LABEL: Record<string, string> = {
  depleted: "Depleted",
  low: "Low",
  healthy: "Healthy",
};

/**
 * Customer detail view (US-B): the selected Customer's current balance, status,
 * and usage history. Crediting the wallet is its own action (see CreditForm),
 * so this view is read-only.
 *
 * The balance is read from the shared ["customers"] query (the same source the
 * list polls), so a top-up applied anywhere converges here too. That query — like
 * every read here — polls on the shared ~5s interval (src/queryClient.ts), so the
 * detail view stays fresh against external writers, not just its own page.
 */
export function CustomerDetail({ customerId }: { customerId: string }) {
  const customers = useQuery({ queryKey: ["customers"], queryFn: fetchCustomers });
  const customer = customers.data?.find((c) => c.id === customerId);

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

      <div className="detail__history">
        <h4 className="detail__history-title">Usage history</h4>
        <UsageHistory customerId={customerId} />
      </div>
    </div>
  );
}
