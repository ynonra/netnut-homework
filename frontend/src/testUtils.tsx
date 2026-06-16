import { ReactElement } from "react";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * Test-only helpers for rendering components that depend on React Query.
 *
 * The component tests pin UX behaviour (US-A/B/C) by mocking ./api and asserting
 * what the rendered DOM shows for each state. They are deliberately decoupled from
 * polling: the test client disables retries and the refetch interval so a render
 * settles deterministically and an assertion can't race a poll tick. The polling
 * contract itself is covered separately in queryClient.test.ts (docs/adr/0003).
 *
 * Not a *.test file, so vitest does not collect it; not imported by main.tsx, so
 * vite never bundles it into the app.
 */
export function createTestClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchInterval: false, gcTime: 0 },
      // retryDelay 0 so a component that opts into mutation retries (ConsumeForm)
      // settles without real backoff timers in the test.
      mutations: { retry: false, retryDelay: 0 },
    },
  });
}

export function renderWithClient(ui: ReactElement, client = createTestClient()) {
  const result = render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
  return { client, ...result };
}
