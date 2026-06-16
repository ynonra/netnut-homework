import { useState } from "react";
import { ConsumeForm } from "./ConsumeForm";
import { CreditForm } from "./CreditForm";
import { CustomerDetail } from "./CustomerDetail";
import { CustomerList, CustomerAction } from "./CustomerList";
import { Modal } from "./Modal";
import { ProductCatalog } from "./ProductCatalog";

const MODAL_TITLE: Record<CustomerAction, string> = {
  details: "Customer details",
  consume: "Consume a product",
  credit: "Credit wallet",
};

export function App() {
  // The open action modal for a customer (US-B/US-C). Each customer row's action
  // buttons open the matching modal; the main content stays the list + catalog.
  const [active, setActive] = useState<{
    customerId: string;
    action: CustomerAction;
  } | null>(null);

  return (
    <div className="app">
      <header className="app__header">
        <h1>Usage-Based Billing</h1>
        <p className="app__subtitle">Customers &amp; product catalog</p>
      </header>
      <main>
        <section className="section">
          <h2 className="section__title">Customers</h2>
          <p className="section__hint">
            Use the actions on each row to view details, consume a product, or
            credit the wallet.
          </p>
          <CustomerList
            onAction={(customerId, action) => setActive({ customerId, action })}
          />
        </section>
        <section className="section">
          <h2 className="section__title">Product catalog</h2>
          <ProductCatalog />
        </section>
      </main>

      {active && (
        <Modal title={MODAL_TITLE[active.action]} onClose={() => setActive(null)}>
          {active.action === "details" && (
            <CustomerDetail customerId={active.customerId} />
          )}
          {active.action === "consume" && (
            <ConsumeForm customerId={active.customerId} />
          )}
          {active.action === "credit" && (
            <CreditForm customerId={active.customerId} />
          )}
        </Modal>
      )}
    </div>
  );
}
