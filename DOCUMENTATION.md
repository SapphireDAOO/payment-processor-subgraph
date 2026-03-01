# Payment Processor Subgraph — Documentation

## Table of Contents

1. [Overview](#1-overview)
2. [Data Sources](#2-data-sources)
3. [Entity Reference](#3-entity-reference)
4. [Invoice State Machines](#4-invoice-state-machines)
5. [Example Queries](#5-example-queries)
6. [Development Guide](#6-development-guide)
7. [Deployment](#7-deployment)

---

## 1. Overview

This subgraph indexes three Sapphire DAO smart contracts deployed on the Sepolia testnet:

- **SimplePaymentProcessor** — A native-token escrow contract. A seller creates an invoice, the buyer pays in ETH, and the seller accepts (releasing funds after a hold period) or rejects (triggering a refund).
- **AdvancedPaymentProcessor** — A multi-token escrow contract with dispute resolution, partial refunds, meta-invoices (batch invoices), and USD-price-pegged payments via Chainlink price feeds.
- **Notes** — An encrypted note store attached to orders. Notes are stored off-chain but their on-chain references and open states are indexed here.

Each contract event triggers a handler in the corresponding AssemblyScript file under `src/`. Handlers read event parameters, optionally call on-chain view functions (via `src/util/storage.ts` and `src/util/token.ts`), and write to the entity store. The `generated/` directory is produced by `graph codegen` from `schema.graphql` and the contract ABIs — do not edit it manually.

---

## 2. Data Sources

### SimplePaymentProcessor

- **Address:** `0xd4a9e5ac9f54beccd7c12ca6bd7bd026bbf0058d`
- **Start block:** `9905398`
- **Handler file:** `src/simple-payment-processor.ts`

| Event                                                | Handler                 | Description                                                                |
| ---------------------------------------------------- | ----------------------- | -------------------------------------------------------------------------- |
| `InvoiceCreated(orderId, invalidateAt, invoice)`     | `handleInvoiceCreated`  | Creates the `SimplePaymentProcessor` entity and registers an `InvoiceType` |
| `InvoicePaid(orderId, buyer, amountPaid, expiresAt)` | `handleInvoicePaid`     | Records buyer, amount paid, and payment tx hash                            |
| `InvoiceAccepted(orderId)`                           | `handleInvoiceAccepted` | Sets the release timestamp and calculates the protocol fee                 |
| `InvoiceCanceled(orderId)`                           | `handleInvoiceCanceled` | Marks the invoice as `CANCELED`                                            |
| `InvoiceRejected(orderId)`                           | `handleInvoiceRejected` | Marks the invoice as `REJECTED` and records the refund tx                  |
| `InvoiceRefunded(orderId)`                           | `handleInvoiceRefunded` | Marks the invoice as `REFUNDED`                                            |
| `InvoiceReleased(orderId)`                           | `handleInvoiceReleased` | Marks the invoice as `RELEASED` and records the release tx                 |
| `UpdateHoldPeriod(orderId, releaseDueTimestamp)`     | `handleHoldPeriod`      | Updates the `releasedAt` timestamp                                         |

### AdvancedPaymentProcessor

- **Address:** `0x3d07827e8a6ba46f37d129df8d99f4ee8aa5685f`
- **Start block:** `9905398`
- **Handler file:** `src/advanced-payment-processor.ts`

| Event / Call                                                | Handler                                 | Description                                                                   |
| ----------------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------- |
| `InvoiceCreated(orderId, invoice)`                          | `handleAdvancedPaymentProcessorCreated` | Creates `AdvancedPaymentProcessor`, `AdminAction`, and `InvoiceType` entities |
| `InvoicePaid(orderId, paymentToken, escrowAddress, amount)` | `handleInvoicePaid`                     | Records payment details, escrow address, and computes fee                     |
| `InvoiceCanceled(orderId)`                                  | `handleInvoiceCanceled`                 | Marks invoice as `CANCELED`                                                   |
| `DisputeCreated(orderId)`                                   | `handleDisputeCreated`                  | Marks invoice as `DISPUTED`                                                   |
| `DisputeDismissed(orderId)`                                 | `handleDisputeDismissed`                | Marks invoice as `DISPUTE DISMISSED`                                          |
| `DisputeResolved(orderId)`                                  | `handleDisputeResolved`                 | Marks invoice as `DISPUTE RESOLVED`                                           |
| `DisputeSettled(orderId, sellerAmount, buyerAmount)`        | `handleDisputeSettled`                  | Marks invoice as `DISPUTE SETTLED`, records commission tx                     |
| `MetaInvoiceCreated(metaInvoiceId, totalPrice)`             | `handleMetaInvoiceCreated`              | Creates a `MetaInvoice` entity                                                |
| `PaymentReleased(orderId, sellerAmount)`                    | `handlePaymentReleased`                 | Marks invoice as `RELEASED`, zeroes balance                                   |
| `Refunded(orderId, amount)`                                 | `handleRefunded`                        | Reduces balance; state becomes `REFUNDED` or `PARTIAL REFUND`                 |
| `UpdateReleaseTime(orderId, newHoldPeriod)`                 | `handleUpdateReleaseTime`               | Extends the escrow hold period                                                |
| `setPriceFeed(token, aggregator)` (call)                    | `handleAllowedTokens`                   | Creates or updates a `PaymentToken` entity                                    |

### Notes

- **Address:** `0xbe210c16e990e74a92eb85060bb33eb03418c565`
- **Start block:** `9905398`
- **Handler file:** `src/notes.ts`

| Event                                                           | Handler                  | Description                                 |
| --------------------------------------------------------------- | ------------------------ | ------------------------------------------- |
| `NoteCreated(orderId, noteId, author, share, encryptedContent)` | `handleNoteCreated`      | Creates a `Note` entity                     |
| `NoteStateChanged(orderId, noteId, user, opened)`               | `handleNoteStateChanged` | Creates or updates a `NoteOpenState` entity |

---

## 3. Entity Reference

### `SimplePaymentProcessor`

Represents one invoice on the SimplePaymentProcessor contract. The entity `id` is the on-chain `orderId` as a string.

| Field              | Type         | Description                                                                        |
| ------------------ | ------------ | ---------------------------------------------------------------------------------- |
| `id`               | `ID!`        | On-chain order ID (numeric string)                                                 |
| `invoiceId`        | `String`     | Internal invoice identifier encoded in the invoice struct                          |
| `state`            | `String`     | Current lifecycle state (see [State Machine](#41-simple-payment-processor-states)) |
| `seller`           | `User`       | Address of the seller who created the invoice                                      |
| `buyer`            | `User`       | Address of the buyer who paid (null until paid)                                    |
| `price`            | `BigInt`     | Invoice price in wei (ETH)                                                         |
| `amountPaid`       | `BigInt`     | Actual amount paid by the buyer in wei                                             |
| `fee`              | `BigInt`     | Protocol fee deducted on acceptance, in wei                                        |
| `contract`         | `Bytes`      | Address of the SimplePaymentProcessor contract                                     |
| `createdAt`        | `BigInt`     | Block timestamp when the invoice was created                                       |
| `paidAt`           | `BigInt`     | Block timestamp when the buyer paid                                                |
| `releasedAt`       | `BigInt`     | Timestamp after which the seller can release funds                                 |
| `invalidateAt`     | `BigInt`     | Timestamp after which the invoice expires if unpaid                                |
| `expiresAt`        | `BigInt`     | Timestamp after which the buyer's payment window closes                            |
| `creationTxHash`   | `String`     | Transaction hash of the invoice creation                                           |
| `paymentTxHash`    | `Bytes`      | Transaction hash of the buyer's payment                                            |
| `commissionTxHash` | `Bytes`      | Transaction hash of the acceptance (commission charge)                             |
| `refundTxHash`     | `Bytes`      | Transaction hash of a refund or rejection                                          |
| `releaseHash`      | `Bytes`      | Transaction hash of the payment release                                            |
| `history`          | `[String!]!` | Ordered list of state transitions (e.g. `["CREATED","PAID","ACCEPTED"]`)           |
| `historyTime`      | `[String!]!` | Block timestamps corresponding to each entry in `history`                          |
| `lastActionTime`   | `BigInt`     | Block timestamp of the most recent state change                                    |
| `buyerNote`        | `String`     | Optional note left by the buyer                                                    |
| `sellerNote`       | `String`     | Optional note left by the seller                                                   |

---

### `AdvancedPaymentProcessor`

Represents one invoice on the AdvancedPaymentProcessor contract. Supports multi-token payments and dispute resolution. The `id` is the on-chain `orderId`.

| Field              | Type           | Description                                                                          |
| ------------------ | -------------- | ------------------------------------------------------------------------------------ |
| `id`               | `ID!`          | On-chain order ID (numeric string)                                                   |
| `invoiceId`        | `String`       | Internal invoice identifier from the invoice struct                                  |
| `state`            | `String`       | Current lifecycle state (see [State Machine](#42-advanced-payment-processor-states)) |
| `seller`           | `User`         | Seller address                                                                       |
| `buyer`            | `User`         | Buyer address (null until paid)                                                      |
| `escrow`           | `Bytes`        | Address of the deployed escrow contract holding funds                                |
| `paymentToken`     | `PaymentToken` | ERC20 token used for payment (references `PaymentToken.id`)                          |
| `price`            | `BigInt`       | Invoice price in the payment token's smallest unit                                   |
| `amountPaid`       | `BigInt`       | Total amount paid by the buyer                                                       |
| `balance`          | `BigInt`       | Current escrow balance (decreases on partial refunds, zeroed on release/full refund) |
| `fee`              | `BigInt`       | Protocol fee amount                                                                  |
| `contract`         | `Bytes!`       | Address of the AdvancedPaymentProcessor contract                                     |
| `createdAt`        | `BigInt`       | Block timestamp of creation                                                          |
| `paidAt`           | `BigInt`       | Block timestamp of payment                                                           |
| `releasedAt`       | `BigInt`       | Timestamp after which funds can be released (updated on `UpdateReleaseTime`)         |
| `invalidateAt`     | `BigInt`       | Invoice expiry timestamp                                                             |
| `expiresAt`        | `BigInt`       | Buyer payment window expiry                                                          |
| `creationTxHash`   | `String`       | Transaction hash of creation                                                         |
| `paymentTxHash`    | `Bytes`        | Transaction hash of payment                                                          |
| `commissionTxHash` | `Bytes`        | Transaction hash of release or dispute settlement (when commission is taken)         |
| `refundTxHash`     | `Bytes`        | Transaction hash of a refund                                                         |
| `releaseHash`      | `Bytes`        | Transaction hash of the release                                                      |
| `history`          | `[String!]!`   | Ordered state transition log                                                         |
| `historyTime`      | `[String!]!`   | Timestamps for each history entry                                                    |
| `lastActionTime`   | `BigInt`       | Most recent state change timestamp                                                   |
| `buyerNote`        | `String`       | Optional note left by the buyer                                                      |
| `sellerNote`       | `String`       | Optional note left by the seller                                                     |

---

### `MetaInvoice`

A meta-invoice groups one or more AdvancedPaymentProcessor invoices into a single payable unit. The `id` is the `metaInvoiceId`.

| Field       | Type     | Description                                      |
| ----------- | -------- | ------------------------------------------------ |
| `id`        | `ID!`    | On-chain meta-invoice ID                         |
| `invoiceId` | `String` | Same as `id` (string form of the numeric ID)     |
| `buyer`     | `User`   | Buyer who paid the meta-invoice                  |
| `price`     | `BigInt` | Total combined price across all sub-invoices     |
| `contract`  | `Bytes!` | Address of the AdvancedPaymentProcessor contract |

---

### `User`

Represents a unique wallet address that has interacted with either processor. The `id` is the checksummed hex address.

| Field              | Type                           | Description                                       |
| ------------------ | ------------------------------ | ------------------------------------------------- |
| `id`               | `ID!`                          | Wallet address (hex string)                       |
| `ownedInvoices`    | `[SimplePaymentProcessor!]!`   | Invoices where this user is the seller (simple)   |
| `paidInvoices`     | `[SimplePaymentProcessor!]!`   | Invoices where this user is the buyer (simple)    |
| `issuedInvoices`   | `[AdvancedPaymentProcessor!]!` | Invoices where this user is the seller (advanced) |
| `receivedInvoices` | `[AdvancedPaymentProcessor!]!` | Invoices where this user is the buyer (advanced)  |
| `metaInvoices`     | `[MetaInvoice!]!`              | Meta-invoices paid by this user                   |

---

### `AdminAction`

A log entry recording the most recent admin-level action on an order. One entity per order (same `id` as the order). Updated in-place as state changes.

| Field       | Type           | Description                                                           |
| ----------- | -------------- | --------------------------------------------------------------------- |
| `id`        | `ID!`          | Same as the order ID                                                  |
| `invoiceId` | `String`       | Internal invoice identifier                                           |
| `action`    | `String`       | The most recent action performed (e.g. `CREATED`, `PAID`, `CANCELED`) |
| `category`  | `String`       | Type of order: `INVOICE` or `META INVOICE`                            |
| `time`      | `BigInt`       | Timestamp of creation                                                 |
| `txHash`    | `String`       | Transaction hash of the most recent action                            |
| `balance`   | `BigInt`       | Current escrow balance at last update                                 |
| `currency`  | `PaymentToken` | Payment token used for this order                                     |

---

### `PaymentToken`

Metadata for an ERC20 token that has been whitelisted via `setPriceFeed`. The `id` is the token's contract address (hex string).

| Field     | Type     | Description                            |
| --------- | -------- | -------------------------------------- |
| `id`      | `ID!`    | Token contract address (hex string)    |
| `name`    | `String` | Token name from the ERC20 contract     |
| `decimal` | `String` | Token decimals from the ERC20 contract |

---

### `InvoiceType`

Records whether an order ID belongs to a `SimplePaymentProcessor` or `AdvancedPaymentProcessor` invoice. Useful for cross-contract lookups. The `id` matches the order ID.

| Field  | Type      | Description                                                                   |
| ------ | --------- | ----------------------------------------------------------------------------- |
| `id`   | `ID!`     | Order ID                                                                      |
| `type` | `String!` | `"SimplePaymentProcessor"`, `"AdvancedPaymentProcessor"`, or `"meta-invoice"` |

---

### `Note`

An encrypted note attached to a specific order. The `id` is `{orderId}-{noteId}`.

| Field              | Type       | Description                                      |
| ------------------ | ---------- | ------------------------------------------------ |
| `id`               | `ID!`      | Composite key: `{orderId}-{noteId}`              |
| `orderId`          | `BigInt!`  | The order this note belongs to                   |
| `noteId`           | `BigInt!`  | Sequential note index within the order           |
| `author`           | `Bytes!`   | Address of the note author                       |
| `share`            | `Boolean!` | Whether the note is shared with the counterparty |
| `encryptedContent` | `Bytes!`   | Encrypted note payload (decrypt off-chain)       |
| `createdAtBlock`   | `BigInt!`  | Block number when the note was created           |
| `createdAtTx`      | `Bytes!`   | Transaction hash of note creation                |

---

### `NoteOpenState`

Tracks whether a given user has opened a specific note. The `id` is `{orderId}-{noteId}-{userAddress}`.

| Field            | Type       | Description                                   |
| ---------------- | ---------- | --------------------------------------------- |
| `id`             | `ID!`      | Composite key: `{orderId}-{noteId}-{address}` |
| `orderId`        | `BigInt!`  | The order this note belongs to                |
| `noteId`         | `BigInt!`  | The note index                                |
| `user`           | `Bytes!`   | The user whose open state is recorded         |
| `opened`         | `Boolean!` | Whether the user has opened the note          |
| `updatedAtBlock` | `BigInt!`  | Block number of the last state change         |
| `updatedAtTx`    | `Bytes!`   | Transaction hash of the last state change     |

---

## 4. Invoice State Machines

All timestamps are Unix seconds stored as `BigInt`.

### 4.1 Simple Payment Processor States

```
                    ┌─────────┐
                    │ CREATED │
                    └────┬────┘
                         │
              ┌──────────┴───────────┐
              │                      │
         buyer pays            seller/time
              │                      │
         ┌────▼────┐           ┌─────▼──────┐
         │  PAID   │           │  CANCELED  │
         └────┬────┘           └────────────┘
              │
     ┌────────┼────────────┐
     │        │            │
  seller    seller       buyer
  accepts   rejects     requests
     │        │            │
┌────▼────┐ ┌─▼────────┐ ┌─▼────────┐
│ACCEPTED │ │ REJECTED │ │ REFUNDED │
└────┬────┘ └──────────┘ └──────────┘
     │
hold period
  elapses
     │
┌────▼────┐
│RELEASED │
└─────────┘
```

| State      | Meaning                                                             |
| ---------- | ------------------------------------------------------------------- |
| `CREATED`  | Invoice created by seller, awaiting payment                         |
| `PAID`     | Buyer paid; seller must accept or reject within the decision window |
| `ACCEPTED` | Seller accepted; funds enter hold period before release             |
| `RELEASED` | Hold period elapsed; funds transferred to seller                    |
| `CANCELED` | Invoice canceled before payment                                     |
| `REJECTED` | Seller rejected the payment; buyer receives a refund                |
| `REFUNDED` | Buyer was refunded (e.g. seller did not respond in time)            |

---

### 4.2 Advanced Payment Processor States

```
                    ┌─────────┐
                    │ CREATED │
                    └────┬────┘
                         │
              ┌──────────┴───────────┐
              │                      │
         buyer pays            buyer/admin
              │                      │
         ┌────▼────┐           ┌─────▼──────┐
         │  PAID   │           │  CANCELED  │
         └────┬────┘           └────────────┘
              │
   ┌──────────┼──────────────┐
   │          │              │
 admin      buyer          hold period
 refunds   disputes         elapses
   │          │              │
   │     ┌────▼────────┐  ┌──▼──────┐
   │     │  DISPUTED   │  │RELEASED │
   │     └────┬────────┘  └─────────┘
   │          │
   │  ┌───────┼──────────────┐
   │  │       │              │
   │ admin  admin           admin
   │dismiss resolve         settle
   │  │       │              │
   │  ▼       ▼              ▼
   │ DISPUTE  DISPUTE     DISPUTE
   │DISMISSED RESOLVED    SETTLED
   │
   │ (if balance > 0)      (if balance == 0)
   ▼                             ▼
PARTIAL REFUND              REFUNDED
```

| State               | Meaning                                                           |
| ------------------- | ----------------------------------------------------------------- |
| `CREATED`           | Invoice created, awaiting payment                                 |
| `PAID`              | Buyer paid; funds held in escrow                                  |
| `RELEASED`          | Funds transferred to seller                                       |
| `CANCELED`          | Invoice canceled before payment                                   |
| `DISPUTED`          | Buyer raised a dispute                                            |
| `DISPUTE DISMISSED` | Admin dismissed the dispute; invoice returns to normal flow       |
| `DISPUTE RESOLVED`  | Admin resolved the dispute in one party's favor                   |
| `DISPUTE SETTLED`   | Admin split the funds between buyer and seller                    |
| `PARTIAL REFUND`    | Part of the escrow balance refunded; remaining balance still held |
| `REFUNDED`          | Full escrow balance refunded to buyer                             |

---

## 5. Example Queries

All queries run against the API endpoint:
`https://api.studio.thegraph.com/query/100227/payment-processor/version/latest`

### Fetch recent simple invoices

```graphql
{
  simplePaymentProcessors(first: 10, orderBy: createdAt, orderDirection: desc) {
    id
    state
    price
    amountPaid
    fee
    seller {
      id
    }
    buyer {
      id
    }
    createdAt
    paidAt
    history
    historyTime
  }
}
```

### Fetch all invoices for a specific seller

```graphql
{
  user(id: "0xabc123...") {
    ownedInvoices {
      id
      state
      price
      buyer {
        id
      }
      createdAt
    }
    issuedInvoices {
      id
      state
      price
      paymentToken {
        name
        decimal
      }
      buyer {
        id
      }
    }
  }
}
```

### Fetch active disputes

```graphql
{
  advancedPaymentProcessors(
    where: { state: "DISPUTED" }
    orderBy: lastActionTime
    orderDirection: desc
  ) {
    id
    invoiceId
    seller {
      id
    }
    buyer {
      id
    }
    balance
    paymentToken {
      id
      name
    }
    history
    historyTime
  }
}
```

### Fetch the admin action log

```graphql
{
  adminActions(
    first: 20
    orderBy: time
    orderDirection: desc
    where: { category: "INVOICE" }
  ) {
    id
    invoiceId
    action
    category
    txHash
    balance
    currency {
      name
    }
    time
  }
}
```

### Fetch a meta-invoice and its buyer

```graphql
{
  metaInvoice(id: "42") {
    id
    price
    contract
    buyer {
      id
    }
  }
}
```

### Fetch notes for an order

```graphql
{
  notes(where: { orderId: "7" }, orderBy: noteId) {
    id
    noteId
    author
    share
    encryptedContent
    createdAtBlock
    createdAtTx
  }
}
```

### Fetch note open states for a user

```graphql
{
  noteOpenStates(where: { user: "0xabc123..." }) {
    id
    orderId
    noteId
    opened
    updatedAtBlock
  }
}
```

### Look up an order's processor type

Useful when you have an `orderId` but don't know which contract it came from.

```graphql
{
  invoiceType(id: "15") {
    type
  }
}
```

### Fetch whitelisted payment tokens

```graphql
{
  paymentTokens {
    id
    name
    decimal
  }
}
```

---

## 6. Development Guide

### Prerequisites

- Node.js ≥ 18
- `npm` or `bun`

### Setup

```bash
git clone <repo>
cd payment-processor-subgraph
npm install
```

### Workflow

After any change to `schema.graphql` or an ABI, regenerate types before building:

```bash
npm run codegen   # regenerates generated/
npm run build     # compiles .ts → .wasm
```

To wipe generated artifacts and rebuild from scratch:

```bash
npm run clean && npm run codegen && npm run build
```

### Local development with Docker

Start a local Graph Node:

```bash
docker-compose up
```

Then deploy to it:

```bash
npm run create-local
npm run deploy-local
```

Query at: `http://localhost:8000/subgraphs/name/payment-processor-indexer`

### Adding a new event handler

1. Add the new entity fields to `schema.graphql` if needed.
2. Add the event to the relevant `eventHandlers` block in `subgraph.yaml`.
3. Run `npm run codegen` to update generated types.
4. Write the handler function in the appropriate `src/*.ts` file.
5. Run `npm run build` to verify it compiles.

---

## 7. Deployment

### Deploy to The Graph Studio

```bash
# Authenticate (one-time)
npx graph auth --studio <deploy-key>

# Deploy
npm run deploy
```

### Deploy with the full script

```bash
npm run deploy:full   # runs scripts/deploy-subgraph.sh
```

### Version the subgraph

The `deploy` command in `package.json` always targets `version/latest`. To publish a versioned release, pass `--version-label` manually:

```bash
npx graph deploy --studio payment-processor-indexer --version-label v1.0.0
```

### Update contract addresses or start blocks

Edit the `source.address` and `source.startBlock` values in `subgraph.yaml`, then redeploy. Setting `startBlock` to the contract deployment block prevents unnecessary re-indexing of older history.
