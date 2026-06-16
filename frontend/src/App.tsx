import { ProductCatalog } from "./ProductCatalog";

export function App() {
  return (
    <div className="app">
      <header className="app__header">
        <h1>Usage-Based Billing</h1>
        <p className="app__subtitle">Product catalog</p>
      </header>
      <main>
        <ProductCatalog />
      </main>
    </div>
  );
}
