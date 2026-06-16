import { useState } from "react";
import { ConsumeForm } from "./ConsumeForm";
import { CustomerDetail } from "./CustomerDetail";
import { CustomerList } from "./CustomerList";
import { ProductCatalog } from "./ProductCatalog";

export function App() {
  // The customer selected for the detail view (US-B). Selecting a row in the list
  // opens the credit-the-wallet form for that customer.
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>();

  return (
    <div className="app">
      <header className="app__header">
        <h1>Usage-Based Billing</h1>
        <p className="app__subtitle">Customers &amp; product catalog</p>
      </header>
      <main>
        <section className="section">
          <h2 className="section__title">Consume a product</h2>
          <ConsumeForm />
        </section>
        <section className="section">
          <h2 className="section__title">Customers</h2>
          <p className="section__hint">Select a customer to credit their wallet.</p>
          <CustomerList
            selectedId={selectedCustomerId}
            onSelect={setSelectedCustomerId}
          />
        </section>
        {selectedCustomerId && (
          <section className="section">
            <h2 className="section__title">Customer detail</h2>
            <CustomerDetail customerId={selectedCustomerId} />
          </section>
        )}
        <section className="section">
          <h2 className="section__title">Product catalog</h2>
          <ProductCatalog />
        </section>
      </main>
    </div>
  );
}
