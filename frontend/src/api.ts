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
