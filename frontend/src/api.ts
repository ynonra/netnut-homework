// API client. Requests go to /api, which the Vite dev server proxies to the
// backend (see vite.config.ts). VITE_API_URL can override the base entirely.

const API_BASE = import.meta.env.VITE_API_URL ?? "/api";

export interface Product {
  id: string;
  name: string;
  /** Unit price in integer minor units (e.g. cents). */
  unitPrice: number;
  createdAt: string;
  updatedAt: string;
}

interface Envelope<T> {
  data: T;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export async function fetchProducts(): Promise<Product[]> {
  const body = await getJson<Envelope<Product[]>>("/products");
  return body.data;
}

export interface Customer {
  id: string;
  name: string;
  /** Current balance in integer minor units (e.g. cents). */
  balance: number;
  createdAt: string;
  updatedAt: string;
}

export async function fetchCustomers(): Promise<Customer[]> {
  const body = await getJson<Envelope<Customer[]>>("/customers");
  return body.data;
}

/** A recorded Consumption Event row returned by POST /consumption-events. */
export interface LedgerEntry {
  id: number;
  customerId: string;
  type: string;
  productId: string | null;
  quantity: number | null;
  unitPrice: number | null;
  /** Signed balance change in minor units (negative for a consumption). */
  amount: number;
  createdAt: string;
}

export interface ConsumeRequest {
  customerId: string;
  productId: string;
  quantity: number;
}

/**
 * Raised when POST /consumption-events returns 402: the wallet lacks sufficient
 * Credits. Carries the structured body so the form can surface it distinctly from
 * a generic failure.
 */
export class InsufficientFundsError extends Error {
  constructor(
    readonly balance: number,
    readonly required: number,
  ) {
    super("insufficient_funds");
    this.name = "InsufficientFundsError";
  }
}

/**
 * Record a Consumption Event. Returns the created ledger entry on success (201),
 * throws InsufficientFundsError on 402, and a generic Error otherwise so the form
 * can render success and insufficient-funds states distinctly (issue #3).
 *
 * `idempotencyKey` (docs/adr/0002) is a client-minted UUID for the submission,
 * reused across retries of that same submission so a retried POST is charged
 * exactly once. The form mints one key per submit and passes it on every retry.
 */
export async function consume(
  req: ConsumeRequest,
  idempotencyKey?: string,
): Promise<LedgerEntry> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (idempotencyKey) {
    headers["Idempotency-Key"] = idempotencyKey;
  }

  const res = await fetch(`${API_BASE}/consumption-events`, {
    method: "POST",
    headers,
    body: JSON.stringify(req),
  });

  if (res.status === 402) {
    const body = (await res.json()) as { balance: number; required: number };
    throw new InsufficientFundsError(body.balance, body.required);
  }
  if (!res.ok) {
    let message = `Request failed: ${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { message?: string };
      if (body.message) message = body.message;
    } catch {
      // non-JSON body; keep the status-based message.
    }
    throw new Error(message);
  }

  const body = (await res.json()) as Envelope<LedgerEntry>;
  return body.data;
}

/**
 * Balances at or below this threshold (in minor units) are "low". This lives on
 * the client because the indicator is purely presentational — the authoritative
 * no-negative-balance invariant is enforced in the backend (docs/adr/0001).
 */
export const LOW_BALANCE_THRESHOLD = 5_00;

export type BalanceStatus = "depleted" | "low" | "healthy";

/** Classify a raw integer balance for the low/depleted indicator (US-A). */
export function balanceStatus(minorUnits: number): BalanceStatus {
  if (minorUnits <= 0) return "depleted";
  if (minorUnits <= LOW_BALANCE_THRESHOLD) return "low";
  return "healthy";
}

/** Format integer minor units as a currency string for display. */
export function formatCredits(minorUnits: number): string {
  return (minorUnits / 100).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
  });
}
