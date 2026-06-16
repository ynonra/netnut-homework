import { CustomerList } from "./CustomerList";
import { ProductCatalog } from "./ProductCatalog";

export function App() {
  return (
    <div className="app">
      <header className="app__header">
        <h1>Usage-Based Billing</h1>
        <p className="app__subtitle">Customers &amp; product catalog</p>
      </header>
      <main>
        <section className="section">
          <h2 className="section__title">Customers</h2>
          <CustomerList />
        </section>
        <section className="section">
          <h2 className="section__title">Product catalog</h2>
          <ProductCatalog />
        </section>
      </main>
    </div>
  );
}
