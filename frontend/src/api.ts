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

/** Format integer minor units as a currency string for display. */
export function formatCredits(minorUnits: number): string {
  return (minorUnits / 100).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
  });
}
