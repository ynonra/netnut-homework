import { useQuery } from "@tanstack/react-query";
import { IconType } from "react-icons";
import { TbCashBanknoteMinus, TbCashBanknotePlus, TbHistory } from "react-icons/tb";
import { balanceStatus, fetchCustomers, formatCredits } from "./api";

const STATUS_LABEL: Record<string, string> = {
  depleted: "Depleted",
  low: "Low",
  healthy: "Healthy",
};

/** The per-row actions, each opening a modal for that customer. */
export type CustomerAction = "details" | "consume" | "credit";

// Tabler icons (react-icons): history for details, cash-minus for consumption
// (money leaves the wallet), cash-plus for a credit/top-up (money enters).
const ACTIONS: {
  action: CustomerAction;
  label: string;
  modifier: string;
  Icon: IconType;
}[] = [
  { action: "details", label: "View details", modifier: "details", Icon: TbHistory },
  { action: "consume", label: "Consume a product", modifier: "consume", Icon: TbCashBanknoteMinus },
  { action: "credit", label: "Credit wallet", modifier: "credit", Icon: TbCashBanknotePlus },
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
                      data-tooltip={label}
                      aria-label={`${label}: ${customer.name}`}
                      onClick={() => onAction?.(customer.id, action)}
                    >
                      <Icon size={18} aria-hidden />
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
