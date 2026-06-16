# Context — Usage-Based Billing

Glossary of domain terms for the billing homework. Definitions only — no implementation detail.

## Terms

### Customer
The account that owns a Wallet and generates Consumption Events. The unit of billing and isolation: one Customer's balance and usage are independent of another's.

### Wallet
A Customer's store of spendable Credits. Holds the current Balance. Exactly one Wallet per Customer.

### Balance
The amount of Credits currently available to spend in a Wallet. Authoritative figure used to decide whether a Consumption Event is allowed. Decreases on consumption, increases on top-up.

### Credit
The unit of value held in a Wallet — a monetary amount. The Balance, Top-ups, and Product Unit Prices are all expressed in this same unit. "Credit the wallet" (verb) = Top-up.

### Product
A thing a Customer can consume. Has a Name and a Unit Price (Credits per unit).

### Unit Price
The Cost in Credits of consuming one unit of a Product.

### Quantity
The number of units of a Product consumed in a single Consumption Event.

### Consumption Event
A single reported act of usage: a Customer consumes a Quantity of a Product. Its Cost = Unit Price × Quantity. Deducts its Cost from the Wallet Balance if sufficient Credits exist; otherwise it is rejected. The system may receive thousands of these per minute for one Customer.

### Cost
The Credits a single Consumption Event deducts from the Balance. Cost = Unit Price × Quantity.

### Top-up
An act that adds Credits to a Wallet, increasing its Balance.

### Usage Event (ledger entry)
A recorded historical row capturing a Consumption Event (and/or Top-up) for audit and history. Append-only. The Balance is kept consistent with the ledger.

### Idempotency Key
A client-minted identifier attached to a single logical Consumption Event submission, carried across retries of that submission. Guarantees a retried submission is recorded (and charged) exactly once. A new submission carries a new key.

## Resolved policy
- **Credit** is a monetary amount (resolved — see Credit).
- **Cost** = Unit Price × Quantity (resolved — see Cost).
- **Overdraft**: Balance may never go negative. No overdraft / credit line. Enforced
  primarily by the atomic deduction guard (`balance >= cost`), and defended at the
  database level by a `CHECK (balance >= 0)` constraint.
