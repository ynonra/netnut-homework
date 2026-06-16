import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { POLL_INTERVAL_MS, createQueryClient } from "./queryClient";

/**
 * These tests pin the freshness contract (issue #8 / docs/adr/0003) at the data
 * layer, independent of any component: every read polls on the shared interval,
 * and a mutation's invalidation triggers an immediate refetch of the affected
 * query rather than waiting for the next poll.
 *
 * Driving the QueryObserver directly (rather than rendering a component) lets us
 * assert refetch timing deterministically — with fake timers for the interval and
 * real timers for the immediacy claim.
 */
describe("polling freshness", () => {
  it("applies the ~5s poll interval as a global query default", () => {
    const client = createQueryClient();
    const defaults = client.getDefaultOptions().queries;
    expect(defaults?.refetchInterval).toBe(POLL_INTERVAL_MS);
    // Background polling keeps the dashboard converging when the tab is hidden.
    expect(defaults?.refetchIntervalInBackground).toBe(true);
  });

  it("refetches a mounted query once per poll interval", async () => {
    vi.useFakeTimers();
    try {
      const client = createQueryClient();
      const queryFn = vi.fn().mockResolvedValue(["data"]);

      const observer = new QueryObserver(client, {
        queryKey: ["customers"],
        queryFn,
      });
      const unsubscribe = observer.subscribe(() => {});

      // Initial fetch.
      await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1));

      // One poll cycle → one more fetch; the interval comes from the shared
      // default, the call site sets nothing.
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
      expect(queryFn).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
      expect(queryFn).toHaveBeenCalledTimes(3);

      unsubscribe();
    } finally {
      vi.useRealTimers();
    }
  });

  it("refetches immediately on the client's own mutation (invalidate), before the next poll", async () => {
    const client = new QueryClient({
      // No interval here: isolate the immediate-invalidation path from polling so
      // an extra fetch can only come from the invalidation, not a poll tick.
      defaultOptions: { queries: { refetchInterval: false } },
    });
    const queryFn = vi.fn().mockResolvedValue(["data"]);

    const observer = new QueryObserver(client, {
      queryKey: ["customers"],
      queryFn,
    });
    const unsubscribe = observer.subscribe(() => {});
    // Let the initial fetch fully settle (data present) before invalidating — an
    // in-flight fetch would dedup the invalidation rather than trigger a new one.
    await vi.waitFor(() => expect(observer.getCurrentResult().isSuccess).toBe(true));
    expect(queryFn).toHaveBeenCalledTimes(1);

    // Simulate the onSuccess of a consume/credit mutation. With no poll interval
    // configured, the only thing that can drive a second fetch is this invalidation.
    await client.invalidateQueries({ queryKey: ["customers"] });

    expect(queryFn).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
});
