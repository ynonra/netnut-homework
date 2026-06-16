import { QueryClient } from "@tanstack/react-query";

/**
 * Polling interval for dashboard freshness, in milliseconds (docs/adr/0003).
 *
 * The DB is the source of truth; the UI converges to it on each poll regardless
 * of which instance or external system wrote. ~5s is the agreed staleness budget
 * for a balance dashboard.
 */
export const POLL_INTERVAL_MS = 5000;

/**
 * The shared QueryClient. `refetchInterval` is set as a global default so every
 * read — the customer list (US-A), the shared customers query the detail view
 * reads (US-B), and the cursor-paginated usage history — polls uniformly without
 * each call site repeating the interval. Mutations refetch their affected queries
 * immediately on success (see ConsumeForm / CustomerDetail), so the client's own
 * writes are reflected without waiting for the next poll.
 *
 * Exposed as a factory so tests can construct an isolated client with the same
 * freshness configuration the app runs with.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchInterval: POLL_INTERVAL_MS,
        // Keep converging even when the tab is backgrounded: an operator watching
        // a burst of consumption land across instances should not see the numbers
        // freeze the moment the window loses focus.
        refetchIntervalInBackground: true,
      },
    },
  });
}
