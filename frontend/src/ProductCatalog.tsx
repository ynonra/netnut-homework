import { useQuery } from "@tanstack/react-query";
import { fetchProducts, formatCredits } from "./api";

/**
 * Renders the product catalog fetched from GET /products.
 *
 * Uses React Query — the same mechanism later slices use for ~5s polling of
 * balances (docs/adr/0003). The catalog itself is static, so no refetchInterval.
 */
export function ProductCatalog() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["products"],
    queryFn: fetchProducts,
  });

  if (isLoading) {
    return <p className="state">Loading catalog…</p>;
  }

  if (isError) {
    return (
      <p className="state state--error">
        Failed to load products: {(error as Error).message}
      </p>
    );
  }

  return (
    <table className="catalog">
      <thead>
        <tr>
          <th>Product</th>
          <th className="num">Unit price</th>
        </tr>
      </thead>
      <tbody>
        {data?.map((product) => (
          <tr key={product.id}>
            <td>{product.name}</td>
            <td className="num">{formatCredits(product.unitPrice)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
