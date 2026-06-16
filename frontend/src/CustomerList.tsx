import { useQuery } from "@tanstack/react-query";
import { balanceStatus, fetchCustomers, formatCredits } from "./api";

const STATUS_LABEL: Record<string, string> = {
  depleted: "Depleted",
  low: "Low",
  healthy: "Healthy",
};

/**
 * Renders the customer list from GET /customers with each balance formatted as
 * currency and a low/depleted indicator (US-A). Selecting a row opens the customer
 * detail view (US-B) where the Wallet can be credited.
 *
 * Polls every ~5s (docs/adr/0003): the balance changes as customers consume and
 * are credited, so the dashboard refetches and converges to DB truth.
 */
export function CustomerList({
  selectedId,
  onSelect,
}: {
  selectedId?: string;
  onSelect?: (customerId: string) => void;
}) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["customers"],
    queryFn: fetchCustomers,
    refetchInterval: 5000,
  });

  if (isLoading) {
    return <p className="state">Loading customers…</p>;
  }

  if (isError) {
    return (
      <p className="state state--error">
        Failed to load customers: {(error as Error).message}
      </p>
    );
  }

  return (
    <table className="catalog">
      <thead>
        <tr>
          <th>Customer</th>
          <th className="num">Balance</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {data?.map((customer) => {
          const status = balanceStatus(customer.balance);
          const selected = customer.id === selectedId;
          return (
            <tr
              key={customer.id}
              className={selected ? "catalog__row--selected" : undefined}
              aria-selected={selected}
              onClick={onSelect ? () => onSelect(customer.id) : undefined}
              style={onSelect ? { cursor: "pointer" } : undefined}
            >
              <td>{customer.name}</td>
              <td className="num">{formatCredits(customer.balance)}</td>
              <td>
                <span
                  className={`badge badge--${status}`}
                  data-status={status}
                  aria-label={`Balance status: ${STATUS_LABEL[status]}`}
                >
                  {STATUS_LABEL[status]}
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
