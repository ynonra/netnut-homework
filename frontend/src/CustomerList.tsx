import { useQuery } from "@tanstack/react-query";
import { balanceStatus, fetchCustomers, formatCredits } from "./api";

const STATUS_LABEL: Record<string, string> = {
  depleted: "Depleted",
  low: "Low",
  healthy: "Healthy",
};

/** The per-row actions, each opening a modal for that customer. */
export type CustomerAction = "details" | "consume" | "credit";

/** Feather-style inline icons so no icon dependency is added. */
function DetailsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function ConsumeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}
function CreditIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="16" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  );
}

const ACTIONS: {
  action: CustomerAction;
  label: string;
  modifier: string;
  Icon: () => JSX.Element;
}[] = [
  { action: "details", label: "View details", modifier: "details", Icon: DetailsIcon },
  { action: "consume", label: "Consume a product", modifier: "consume", Icon: ConsumeIcon },
  { action: "credit", label: "Credit wallet", modifier: "credit", Icon: CreditIcon },
];

/**
 * Renders the customer list from GET /customers with each balance formatted as
 * currency and a low/depleted indicator (US-A). Each row ends with three action
 * buttons — details, consume, credit — that open the matching modal for that
 * customer (US-B/US-C). The buttons carry a tooltip (title) and aria-label.
 *
 * Polls every ~5s (docs/adr/0003): balances change as customers consume and are
 * credited, so the dashboard refetches and converges to DB truth. The interval
 * comes from the shared QueryClient default (src/queryClient.ts), not repeated here.
 */
export function CustomerList({
  onAction,
}: {
  onAction?: (customerId: string, action: CustomerAction) => void;
}) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["customers"],
    queryFn: fetchCustomers,
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
          <th className="num">Actions</th>
        </tr>
      </thead>
      <tbody>
        {data?.map((customer) => {
          const status = balanceStatus(customer.balance);
          return (
            <tr key={customer.id}>
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
              <td className="num">
                <div className="row-actions">
                  {ACTIONS.map(({ action, label, modifier, Icon }) => (
                    <button
                      key={action}
                      type="button"
                      className={`icon-btn icon-btn--${modifier}`}
                      title={`${label} — ${customer.name}`}
                      aria-label={`${label}: ${customer.name}`}
                      onClick={() => onAction?.(customer.id, action)}
                    >
                      <Icon />
                    </button>
                  ))}
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
