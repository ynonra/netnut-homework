import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  fetchProducts,
  fetchUsageEvents,
  formatCredits,
  LedgerEntry,
  UsageEventsPage,
} from "./api";

const PAGE_SIZE = 25;

/** Format an ISO timestamp for the history rows. */
function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** Human label for a ledger entry's type. */
function typeLabel(type: string): string {
  if (type === "CONSUMPTION") return "Consumed";
  if (type === "CREDIT") return "Credited";
  return type;
}

/**
 * Newest-first, cursor-paginated Usage history for one Customer (US-B). Renders
 * every LedgerEntry — CONSUMPTION and CREDIT rows — and pages backwards through
 * older entries with a load-more control.
 *
 * Backed by useInfiniteQuery over GET /customers/:id/usage-events: each page
 * carries a `nextCursor` (the Int id of its last row, docs/adr/0004); a null
 * cursor marks the last page, so the load-more button hides itself. The query key
 * is scoped to the customer so switching customers fetches a fresh first page.
 *
 * The empty-history state (no rows at all) is handled distinctly from loading and
 * error, so the no-consumption customer reads as "no usage yet" rather than blank.
 *
 * Polls on the shared ~5s interval (src/queryClient.ts, docs/adr/0003): a
 * consumption applied by another instance or an external system appends ledger
 * rows this client never wrote, and the poll refetches the loaded pages so they
 * surface within one cycle. The client's own top-up additionally invalidates this
 * query immediately (see CustomerDetail) for instant feedback.
 */
export function UsageHistory({ customerId }: { customerId: string }) {
  const {
    data,
    isLoading,
    isError,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery<UsageEventsPage, Error>({
    queryKey: ["usage-events", customerId],
    queryFn: ({ pageParam }) =>
      fetchUsageEvents(customerId, pageParam as number | null, PAGE_SIZE),
    initialPageParam: null as number | null,
    // null nextCursor → last page; returning undefined disables further fetches.
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  // Resolve product ids to names from the (small, cached) catalog. The ledger
  // stores productId, not the name; CREDIT rows have no product.
  const products = useQuery({ queryKey: ["products"], queryFn: fetchProducts });
  const productNameById = new Map(
    (products.data ?? []).map((p) => [p.id, p.name]),
  );
  const productLabel = (row: LedgerEntry): string =>
    row.productId ? productNameById.get(row.productId) ?? "—" : "—";

  if (isLoading) {
    return <p className="state">Loading history…</p>;
  }
  if (isError) {
    return (
      <p className="state state--error">
        Failed to load history: {error.message}
      </p>
    );
  }

  const rows: LedgerEntry[] = data?.pages.flatMap((p) => p.data) ?? [];

  if (rows.length === 0) {
    return <p className="state history__empty">No usage yet.</p>;
  }

  return (
    <div className="history">
      <table className="catalog">
        <thead>
          <tr>
            <th>When</th>
            <th>Type</th>
            <th>Product</th>
            <th className="num">Qty</th>
            <th className="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{formatWhen(row.createdAt)}</td>
              <td>
                <span
                  className={`badge badge--${
                    row.type === "CREDIT" ? "healthy" : "low"
                  }`}
                >
                  {typeLabel(row.type)}
                </span>
              </td>
              <td>{productLabel(row)}</td>
              <td className="num">{row.quantity ?? "—"}</td>
              <td className="num">{formatCredits(row.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {hasNextPage && (
        <button
          type="button"
          className="history__more"
          onClick={() => void fetchNextPage()}
          disabled={isFetchingNextPage}
        >
          {isFetchingNextPage ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}
