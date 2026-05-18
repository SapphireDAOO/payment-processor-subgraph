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

This subgraph indexes four Sapphire DAO smart contracts deployed on Base Sepolia and reads shared config from the storage contract:

- **SimplePaymentProcessor** — A native-token escrow contract. A seller creates an invoice, the buyer pays in ETH, and the seller accepts (releasing funds after a hold period) or rejects (triggering a refund).
- **AdvancedPaymentProcessor** — A multi-token escrow contract with dispute resolution, partial refunds, meta-invoices (batch invoices), and USD-price-pegged payments via Chainlink price feeds.
- **Notes** — An encrypted note store attached to invoices. Notes are stored off-chain but their on-chain references and open states are indexed here.
- **MultiSig** — A wallet governance contract whose signer set, threshold, proposed transactions, approvals, and executions are indexed here.

Shared helper contract:

- **PaymentProcessorStorage** — Read by mappings through `src/util/storage.ts` for fee rate and default hold period lookups.

Each contract event triggers a handler in the corresponding AssemblyScript file under `src/`. Handlers read event parameters, optionally call on-chain view functions (via `src/util/storage.ts` and `src/util/token.ts`), and write to the entity store. The `generated/` directory is produced by `graph codegen` from `schema.graphql` and the contract ABIs — do not edit it manually.

---

## 2. Data Sources

### SimplePaymentProcessor

- **Address:** `0xd70c10c73a716f85d97b5619dadfb6b1b6b6a706`
- **Start block:** `40636475`
- **Handler file:** `src/simple-payment-processor.ts`

| Event                                                    | Handler                 | Description                                                                |
| -------------------------------------------------------- | ----------------------- | -------------------------------------------------------------------------- |
| `InvoiceCreated(invoiceId, invoice)`                     | `handleInvoiceCreated`  | Creates the `SimplePaymentProcessor` entity and registers an `InvoiceType` |
| `InvoicePaid(invoiceId, buyer, amountPaid, expiresAt)`   | `handleInvoicePaid`     | Records buyer, amount paid, and payment tx hash                            |
| `InvoiceAccepted(invoiceId)`                             | `handleInvoiceAccepted` | Sets the release timestamp and calculates the protocol fee                 |
| `InvoiceCanceled(invoiceId)`                             | `handleInvoiceCanceled` | Marks the invoice as `CANCELED`                                            |
| `InvoiceRejected(invoiceId)`                             | `handleInvoiceRejected` | Marks the invoice as `REJECTED` and records the refund tx                  |
| `InvoiceRefunded(invoiceId)`                             | `handleInvoiceRefunded` | Marks the invoice as `REFUNDED`                                            |
| `InvoiceReleased(invoiceId)`                             | `handleInvoiceReleased` | Marks the invoice as `RELEASED` and records the release tx                 |
| `UpdateHoldPeriod(invoiceId, releaseDueTimestamp)`       | `handleHoldPeriod`      | Updates the `releasedAt` timestamp                                         |

### AdvancedPaymentProcessor

- **Address:** `0x792af6df4f32ac3b8c2745dee42f9e08090c0746`
- **Start block:** `40636475`
- **Handler file:** `src/advanced-payment-processor.ts`

| Event / Call                                                     | Handler                                 | Description                                                                   |
| ---------------------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------- |
| `InvoiceCreated(invoiceId, invoice)`                             | `handleAdvancedPaymentProcessorCreated` | Creates `AdvancedPaymentProcessor`, `AdminAction`, and `InvoiceType` entities |
| `InvoicePaid(invoiceId, paymentToken, escrowAddress, amount, releaseAt)` | `handleInvoicePaid`                     | Records payment details, escrow address, release time, and fee                |
| `InvoiceCanceled(invoiceId)`                                     | `handleInvoiceCanceled`                 | Marks invoice as `CANCELED`                                                   |
| `DisputeCreated(invoiceId)`                                      | `handleDisputeCreated`                  | Marks invoice as `DISPUTED`                                                   |
| `DisputeDismissed(invoiceId)`                                    | `handleDisputeDismissed`                | Marks invoice as `DISPUTE DISMISSED`                                          |
| `DisputeResolved(invoiceId)`                                     | `handleDisputeResolved`                 | Marks invoice as `DISPUTE RESOLVED`                                           |
| `DisputeSettled(invoiceId, sellerAmount, buyerAmount)`           | `handleDisputeSettled`                  | Marks invoice as `DISPUTE SETTLED`, records commission tx                     |
| `MetaInvoiceCreated(metaInvoiceId, totalPrice)`                  | `handleMetaInvoiceCreated`              | Creates a `MetaInvoice` entity                                                |
| `PaymentReleased(invoiceId, receiver, currency, sellerAmount)`   | `handlePaymentReleased`                 | Marks invoice as `RELEASED`, zeroes balance                                   |
| `Refunded(invoiceId, amount)`                                    | `handleRefunded`                        | Reduces balance and marks invoice `REFUNDED`                                  |
| `UpdateReleaseTime(invoiceId, newHoldPeriod)`                    | `handleUpdateReleaseTime`               | Extends the escrow hold period                                                |

### Notes

- **Address:** `0x8391a68c01834d252c1dff975a621e8f99020b65`
- **Start block:** `40636475`
- **Handler file:** `src/notes.ts`

| Event                                                                | Handler                  | Description                                 |
| -------------------------------------------------------------------- | ------------------------ | ------------------------------------------- |
| `NoteCreated(invoiceId, noteId, author, share, encryptedContent)`    | `handleNoteCreated`      | Creates a `Note` entity                     |
| `NoteStateChanged(invoiceId, noteId, user, opened)`                  | `handleNoteStateChanged` | Creates or updates a `NoteOpenState` entity |

### MultiSig

- **Address:** `0x331798ef8a2a46b6e6a5864ba7f03016b875f193`
- **Start block:** `40669962`
- **Handler file:** `src/multi-sig.ts`

| Event                                                                | Handler                      | Description                                                                       |
| -------------------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------- |
| `SignerAdded(signer)`                                                | `handleSignerAdded`          | Activates the signer (creates `MultiSigSigner` if new) and bumps `signerCount`    |
| `SignerRemoved(signer)`                                              | `handleSignerRemoved`        | Deactivates the signer and decrements `signerCount`                               |
| `ThresholdUpdated(oldThreshold, newThreshold)`                       | `handleThresholdUpdated`     | Updates the wallet approval threshold                                             |
| `TransactionProposed(txHash, target, value, data, nonce, proposer)`  | `handleTransactionProposed`  | Creates a `MultiSigTransaction` in `PROPOSED` state                               |
| `ApprovalAdded(txHash, approver, approvalCount)`                     | `handleApprovalAdded`        | Records a `MultiSigApproval` and updates the transaction's `approvalCount`        |
| `TransactionApproved(txHash)`                                        | `handleTransactionApproved`  | Marks the transaction as `APPROVED` (threshold reached, ready to execute)         |
| `TransactionCanceled(txHash)`                                        | `handleTransactionCanceled`  | Marks the transaction as `CANCELED`                                               |
| `TransactionExecuted(txHash, executor)`                              | `handleTransactionExecuted`  | Marks the transaction as `EXECUTED` and records executor + timestamp              |

---

## 3. Entity Reference

### `SimplePaymentProcessor`

Represents one invoice on the SimplePaymentProcessor contract. The entity `id` is the on-chain `invoiceId` as a string.

| Field              | Type         | Description                                                                        |
| ------------------ | ------------ | ---------------------------------------------------------------------------------- |
| `id`               | `ID!`        | On-chain invoice ID (numeric string)                                               |
| `invoiceNonce`     | `String`     | Internal invoice nonce encoded in the invoice struct                               |
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

Represents one invoice on the AdvancedPaymentProcessor contract. Supports multi-token payments and dispute resolution. The `id` is the on-chain `invoiceId`.

| Field              | Type           | Description                                                                          |
| ------------------ | -------------- | ------------------------------------------------------------------------------------ |
| `id`               | `ID!`          | On-chain invoice ID (numeric string)                                                 |
| `invoiceNonce`     | `String`       | Internal invoice nonce encoded in the invoice struct                                 |
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

A log entry recording the most recent admin-level action on an invoice. One entity per invoice (same `id` as the invoice). Updated in-place as state changes.

| Field       | Type           | Description                                                           |
| ----------- | -------------- | --------------------------------------------------------------------- |
| `id`           | `ID!`          | Same as the invoice ID                                                |
| `invoiceNonce` | `String`       | Internal invoice nonce                                                |
| `action`    | `String`       | The most recent action performed (e.g. `CREATED`, `PAID`, `CANCELED`) |
| `category`  | `String`       | Type of invoice action: `INVOICE` or `META INVOICE`                   |
| `time`      | `BigInt`       | Timestamp of creation                                                 |
| `txHash`    | `String`       | Transaction hash of the most recent action                            |
| `balance`   | `BigInt`       | Current escrow balance at last update                                 |
| `currency`  | `PaymentToken` | Payment token used for this invoice                                   |

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

Records whether an invoice ID belongs to a `SimplePaymentProcessor` or `AdvancedPaymentProcessor` invoice. Useful for cross-contract lookups. The `id` matches the invoice ID.

| Field  | Type      | Description                                                                   |
| ------ | --------- | ----------------------------------------------------------------------------- |
| `id`   | `ID!`     | Invoice ID                                                                    |
| `type` | `String!` | `"SimplePaymentProcessor"`, `"AdvancedPaymentProcessor"`, or `"meta-invoice"` |

---

### `Note`

An encrypted note attached to a specific invoice. The `id` is `{invoiceId}-{noteId}`.

| Field              | Type       | Description                                      |
| ------------------ | ---------- | ------------------------------------------------ |
| `id`               | `ID!`      | Composite key: `{invoiceId}-{noteId}`            |
| `invoiceId`        | `BigInt!`  | The invoice this note belongs to                 |
| `noteId`           | `BigInt!`  | Sequential note index within the invoice         |
| `author`           | `Bytes!`   | Address of the note author                       |
| `share`            | `Boolean!` | Whether the note is shared with the counterparty |
| `encryptedContent` | `Bytes!`   | Encrypted note payload (decrypt off-chain)       |
| `createdAtBlock`   | `BigInt!`  | Block number when the note was created           |
| `createdAtTx`      | `Bytes!`   | Transaction hash of note creation                |

---

### `NoteOpenState`

Tracks whether a given user has opened a specific note. The `id` is `{invoiceId}-{noteId}-{userAddress}`.

| Field            | Type       | Description                                      |
| ---------------- | ---------- | ------------------------------------------------ |
| `id`             | `ID!`      | Composite key: `{invoiceId}-{noteId}-{address}`  |
| `invoiceId`      | `BigInt!`  | The invoice this note belongs to                 |
| `noteId`         | `BigInt!`  | The note index                                |
| `user`           | `Bytes!`   | The user whose open state is recorded         |
| `opened`         | `Boolean!` | Whether the user has opened the note          |
| `updatedAtBlock` | `BigInt!`  | Block number of the last state change         |
| `updatedAtTx`    | `Bytes!`   | Transaction hash of the last state change     |

---

### `MultiSigWallet`

The indexed multisig contract. The `id` is the wallet's contract address. State (`threshold`, `signerCount`, `transactionCount`) is kept in sync via `try_*` view-call reads on every event.

| Field              | Type                    | Description                                                       |
| ------------------ | ----------------------- | ----------------------------------------------------------------- |
| `id`               | `ID!`                   | Wallet contract address                                           |
| `threshold`        | `BigInt!`               | Number of approvals required to execute a transaction             |
| `signerCount`      | `BigInt!`               | Number of currently-active signers                                |
| `transactionCount` | `BigInt!`               | On-chain nonce (total transactions ever proposed)                 |
| `signers`          | `[MultiSigSigner!]!`    | Derived: all signers that have ever been added (active or not)    |
| `transactions`     | `[MultiSigTransaction!]!` | Derived: all proposed transactions                              |

---

### `MultiSigSigner`

A signer record per `(wallet, signer address)`. Re-adding a previously removed signer reactivates the existing record. The `id` is `{walletAddress}-{signerAddress}`.

| Field        | Type                  | Description                                                  |
| ------------ | --------------------- | ------------------------------------------------------------ |
| `id`         | `ID!`                 | Composite key: `{walletAddress}-{signerAddress}`             |
| `wallet`     | `MultiSigWallet!`     | The multisig wallet                                          |
| `address`    | `Bytes!`              | Signer EOA / contract address                                |
| `active`     | `Boolean!`            | Whether the signer is currently active                       |
| `addedAt`    | `BigInt!`             | Timestamp of the most recent `SignerAdded` event             |
| `removedAt`  | `BigInt`              | Timestamp of the most recent `SignerRemoved` (null if active) |
| `approvals`  | `[MultiSigApproval!]!` | Derived: every approval this signer has cast                |

---

### `MultiSigTransaction`

A proposed multisig call. The `id` is the on-chain `txHash` (bytes32).

| Field           | Type                   | Description                                                       |
| --------------- | ---------------------- | ----------------------------------------------------------------- |
| `id`            | `Bytes!`               | `txHash` of the proposal                                          |
| `wallet`        | `MultiSigWallet!`      | The multisig that owns this proposal                              |
| `target`        | `Bytes!`               | Contract / EOA the call is directed at                            |
| `value`         | `BigInt!`              | Native value attached to the call                                 |
| `data`          | `Bytes!`               | Calldata for the proposed call                                    |
| `nonce`         | `BigInt!`              | Wallet nonce assigned at proposal time                            |
| `proposer`      | `Bytes!`               | Signer that proposed the transaction                              |
| `status`        | `String!`              | Lifecycle state (see [MultiSig States](#43-multisig-transaction-states)) |
| `approvalCount` | `BigInt!`              | Current number of approvals                                       |
| `proposedAt`    | `BigInt!`              | Block timestamp of `TransactionProposed`                          |
| `executedAt`    | `BigInt`               | Block timestamp of `TransactionExecuted` (null until executed)    |
| `executor`      | `Bytes`                | Address that executed the transaction                             |
| `approvals`     | `[MultiSigApproval!]!` | Derived: per-signer approval records                              |

---

### `MultiSigApproval`

One record per `(txHash, approver)` approval. The `id` is `{txHash}-{approverAddress}`.

| Field           | Type                   | Description                                                              |
| --------------- | ---------------------- | ------------------------------------------------------------------------ |
| `id`            | `ID!`                  | Composite key: `{txHash}-{approverAddress}`                              |
| `transaction`   | `MultiSigTransaction!` | The transaction being approved                                           |
| `signer`        | `MultiSigSigner`       | The signer record (null if the approver has no `MultiSigSigner` entity)  |
| `approver`      | `Bytes!`               | Approver address (raw, even when no signer record exists)                |
| `approvalCount` | `BigInt!`              | Running approval count at the time of this approval                      |
| `approvedAt`    | `BigInt!`              | Block timestamp of the `ApprovalAdded` event                             |

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
   ▼
REFUNDED
```

| State               | Meaning                                                       |
| ------------------- | ------------------------------------------------------------- |
| `CREATED`           | Invoice created, awaiting payment                             |
| `PAID`              | Buyer paid; funds held in escrow                              |
| `RELEASED`          | Funds transferred to seller                                   |
| `CANCELED`          | Invoice canceled before payment                               |
| `DISPUTED`          | Buyer raised a dispute                                        |
| `DISPUTE DISMISSED` | Admin dismissed the dispute; invoice returns to normal flow   |
| `DISPUTE RESOLVED`  | Admin resolved the dispute in one party's favor               |
| `DISPUTE SETTLED`   | Admin split the funds between buyer and seller                |
| `REFUNDED`          | Escrow balance refunded to buyer                              |

---

### 4.3 MultiSig Transaction States

```
              ┌──────────┐
              │ PROPOSED │
              └────┬─────┘
                   │
        ┌──────────┴──────────┐
        │                     │
  threshold            proposer/signer
   reached             cancels
        │                     │
   ┌────▼─────┐          ┌────▼─────┐
   │ APPROVED │          │ CANCELED │
   └────┬─────┘          └──────────┘
        │
  signer executes
        │
   ┌────▼─────┐
   │ EXECUTED │
   └──────────┘
```

| State      | Meaning                                                                  |
| ---------- | ------------------------------------------------------------------------ |
| `PROPOSED` | Transaction proposed; awaiting approvals                                 |
| `APPROVED` | Approval threshold reached; ready to execute                             |
| `EXECUTED` | Transaction has been executed on-chain                                   |
| `CANCELED` | Transaction was canceled before execution                                |

---

## 5. Example Queries

All queries run against the API endpoint:
`https://api.studio.thegraph.com/query/100227/processor-indexer/0.06`

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
    invoiceNonce
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
    invoiceNonce
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

### Fetch notes for an invoice

```graphql
{
  notes(where: { invoiceId: 7 }, orderBy: noteId) {
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
    invoiceId
    noteId
    opened
    updatedAtBlock
  }
}
```

### Look up an invoice's processor type

Useful when you have an `invoiceId` but don't know which contract it came from.

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

### Fetch a multisig wallet with active signers and pending transactions

```graphql
{
  multiSigWallet(id: "0x331798ef8a2a46b6e6a5864ba7f03016b875f193") {
    threshold
    signerCount
    transactionCount
    signers(where: { active: true }) {
      address
      addedAt
    }
    transactions(
      where: { status: "PROPOSED" }
      orderBy: proposedAt
      orderDirection: desc
    ) {
      id
      target
      value
      proposer
      approvalCount
      proposedAt
      approvals {
        approver
        approvedAt
      }
    }
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

Query at: `http://localhost:8000/subgraphs/name/processor-indexer`

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

The `deploy` command in `package.json` prompts for a version label. To publish non-interactively, pass `--version-label` manually:

```bash
npx graph deploy --node https://api.studio.thegraph.com/deploy/ processor-indexer --version-label 0.06
```

### Update contract addresses or start blocks

Edit the `source.address` and `source.startBlock` values in `subgraph.yaml`, then redeploy. Setting `startBlock` to the contract deployment block prevents unnecessary re-indexing of older history.
