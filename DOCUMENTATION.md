# Payment Processor Subgraph — Documentation

This document covers the indexed data and how to query it. For setup, configuration, local development, and deployment, see **[README.md](README.md)**.

## Table of Contents

1. [Overview](#1-overview)
2. [Data Sources](#2-data-sources)
3. [Entity Reference](#3-entity-reference)
4. [Invoice State Machines](#4-invoice-state-machines)
5. [Dashboard Metrics](#5-dashboard-metrics)
6. [Example Queries](#6-example-queries)

---

## 1. Overview

This subgraph indexes the Sapphire DAO smart contracts and reads shared config from the storage contract:

- **SimplePaymentProcessor** — A native-token (ETH) escrow contract. A seller creates an invoice, the buyer pays in ETH, and the seller accepts (releasing funds after a hold period) or rejects (triggering a refund).
- **AdvancedPaymentProcessor** — A multi-token escrow contract with dispute resolution, partial refunds, meta-invoices (batch invoices), and USD-price-pegged payments via oracle price feeds.
- **Notes** — An encrypted note store attached to invoices. Notes are stored off-chain but their on-chain references and open states are indexed here.
- **MultiSig** — A wallet governance contract whose signer set, threshold, proposed transactions, approvals, and executions are indexed here.
- **OracleManager** — Emits `PriceFeedSet` when a token gains a price feed; the handler registers the token's `PaymentToken` metadata.

Shared helper contract:

- **PaymentProcessorStorage** — Read by mappings through `src/util/storage.ts` for fee rate and default hold period lookups.

### Event-log model

Per-invoice history is **not** stored as arrays on the invoice. Instead every handler appends an immutable [`InvoiceEvent`](#invoiceevent) row, and each invoice exposes its log through the derived `events` field. This keeps invoice entities small and makes the activity log append-only and time-travel friendly.

### Aggregated metrics

Alongside the per-invoice entities, the mappings maintain a small set of global aggregates for the dashboard — cumulative volume, live escrow, fees, counters, recent transactions, and gas — in [`MetricData`](#metricdata), [`TokenMetric`](#tokenmetric), [`RecentTransaction`](#recenttransaction) and [`GasPaid`](#gaspaid). See [Dashboard Metrics](#5-dashboard-metrics).

Each contract event triggers a handler in the corresponding AssemblyScript file under `src/`. Handlers read event parameters, optionally call on-chain view functions (via `src/util/storage.ts` and `src/util/token.ts`), and write to the entity store. Shared metric helpers live in `src/util/metrics.ts`. The `generated/` directory is produced by `graph codegen` from `schema.graphql` and the contract ABIs — do not edit it manually.

---

## 2. Data Sources

The manifest (`subgraph.yaml`) is currently configured for a **local chain** (`network: localhost`, `startBlock: 0`). For a testnet/mainnet deployment, swap each `source.address`, set `source.startBlock` to the contract's deployment block, and change `network` to match your Graph Node's configured chain. The addresses below are the deterministic local-dev deployment addresses.

### SimplePaymentProcessor

- **Address:** `0x5FC8d32690cc91D4c39d9d3abcBD16989F875707`
- **Handler file:** `src/simple-payment-processor.ts`

| Event                                                  | Handler                       | Description                                                          |
| ------------------------------------------------------ | ----------------------------- | ------------------------------------------------------------------- |
| `InvoiceCreated(invoiceId, invoice)`                   | `handleInvoiceCreated`        | Creates the `SimplePaymentProcessor` entity and the seller `User`   |
| `InvoicePaid(invoiceId, buyer, amountPaid, expiresAt)` | `handleInvoicePaid`           | Records buyer and amount paid; adds volume/escrow + recent tx       |
| `InvoiceAccepted(invoiceId)`                           | `handleInvoiceAccepted`       | Computes the protocol fee and sets `releaseAt` (default hold period) |
| `InvoiceCanceled(invoiceId)`                           | `handleInvoiceCanceled`       | Marks the invoice `CANCELED`                                         |
| `InvoiceRejected(invoiceId)`                           | `handleInvoiceRejected`       | Marks the invoice `REJECTED`; reverses escrow                       |
| `InvoiceRefunded(invoiceId)`                           | `handleInvoiceRefunded`       | Marks the invoice `REFUNDED`; reverses escrow                       |
| `InvoiceReleased(invoiceId)`                           | `handleInvoiceReleased`       | Marks the invoice `RELEASED`; reverses escrow + recent tx           |
| `UpdateHoldPeriod(invoiceId, releaseDueTimestamp)`     | `handleHoldPeriod`            | Sets `releaseAt` from the event                                     |
| `LockedPaymentRecovered(invoiceId, to, amount)`        | `handleLockedPaymentRecovered`| Logs the recovery event                                            |
| `TransferFailed(invoiceId, to, amount)`                | `handleTransferFailed`        | Logs the failed-transfer event                                     |
| `WithdrawalRetried(invoiceId, to, amount, retries)`    | `handleWithdrawalRetried`     | Logs the withdrawal-retry event                                    |

### AdvancedPaymentProcessor

- **Address:** `0xa513E6E4b8f2a923D98304ec87F64353C4D5C853`
- **Handler file:** `src/advanced-payment-processor.ts`

| Event                                                                    | Handler                                 | Description                                                                |
| ------------------------------------------------------------------------ | --------------------------------------- | -------------------------------------------------------------------------- |
| `InvoiceCreated(invoiceId, invoice)`                                     | `handleAdvancedPaymentProcessorCreated` | Creates the `AdvancedPaymentProcessor` entity, links `metaInvoice` if any  |
| `InvoicePaid(invoiceId, paymentToken, escrowAddress, amount, releaseAt)` | `handleInvoicePaid`                     | Records payment, token, escrow, `releaseAt`, fee; adds volume/escrow + tx  |
| `InvoiceCanceled(invoiceId)`                                             | `handleInvoiceCanceled`                 | Marks invoice `CANCELED`                                                    |
| `DisputeCreated(invoiceId)`                                              | `handleDisputeCreated`                  | Marks invoice `DISPUTED`                                                    |
| `DisputeDismissed(invoiceId)`                                            | `handleDisputeDismissed`                | Marks invoice `DISPUTE_DISMISSED`                                           |
| `DisputeResolved(invoiceId)`                                             | `handleDisputeResolved`                 | Marks invoice `DISPUTE_RESOLVED`                                            |
| `DisputeSettled(invoiceId, sellerAmount, buyerAmount)`                   | `handleDisputeSettled`                  | Marks `DISPUTE_SETTLED`; records split amounts; reverses escrow            |
| `MetaInvoiceCreated(metaInvoiceId, totalPrice)`                          | `handleMetaInvoiceCreated`              | Creates a `MetaInvoice` entity                                             |
| `PaymentReleased(invoiceId, receiver, currency, sellerAmount)`           | `handlePaymentReleased`                 | Marks `RELEASED`, zeroes balance; reverses escrow + recent tx             |
| `Refunded(invoiceId, amount)`                                            | `handleRefunded`                        | Reduces balance, marks `REFUNDED`; reverses the refunded portion of escrow |
| `UpdateReleaseTime(invoiceId, newHoldPeriod)`                            | `handleUpdateReleaseTime`               | Recomputes `releaseAt` as `now + newHoldPeriod`                            |
| `EscrowCreated(invoiceId, escrow)`                                       | `handleEscrowCreated`                   | Records the escrow contract address                                        |
| `LockedPaymentRecovered(invoiceId, to, amount)`                          | `handleLockedPaymentRecovered`          | Logs the recovery event                                                    |
| `OracleUpdated(previousOracle, newOracle)`                               | `handleOracleUpdated`                   | Logs the oracle change (processor-level event)                            |
| `TransferFailed(invoiceId, to, amount)`                                  | `handleTransferFailed`                  | Logs the failed-transfer event                                            |
| `WithdrawalRetried(invoiceId, to, amount, retries)`                      | `handleWithdrawalRetried`               | Logs the withdrawal-retry event                                           |

Every advanced action **except payment** also accrues to [`GasPaid`](#gaspaid).

### Notes

- **Address:** `0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9`
- **Handler file:** `src/notes.ts`

| Event                                                             | Handler                  | Description                                 |
| ----------------------------------------------------------------- | ------------------------ | ------------------------------------------- |
| `NoteCreated(invoiceId, noteId, author, share, encryptedContent)` | `handleNoteCreated`      | Creates a `Note` entity                     |
| `NoteStateChanged(invoiceId, noteId, user, opened)`               | `handleNoteStateChanged` | Creates or updates a `NoteOpenState` entity |

### MultiSig

- **Address:** `0x5FbDB2315678afecb367f032d93F642f64180aa3`
- **Handler file:** `src/multi-sig.ts`

| Event                                                               | Handler                     | Description                                                                    |
| ------------------------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------- |
| `SignerAdded(signer)`                                               | `handleSignerAdded`         | Activates the signer (creates `MultiSigSigner` if new) and bumps `signerCount` |
| `SignerRemoved(signer)`                                             | `handleSignerRemoved`       | Deactivates the signer and decrements `signerCount`                           |
| `ThresholdUpdated(oldThreshold, newThreshold)`                      | `handleThresholdUpdated`    | Updates the wallet approval threshold                                         |
| `TransactionProposed(txHash, target, value, data, nonce, proposer)` | `handleTransactionProposed` | Creates a `MultiSigTransaction` in `PROPOSED` state                           |
| `ApprovalAdded(txHash, approver, approvalCount)`                    | `handleApprovalAdded`       | Records a `MultiSigApproval` and updates the transaction's `approvalCount`     |
| `TransactionApproved(txHash)`                                       | `handleTransactionApproved` | Marks the transaction `APPROVED`                                              |
| `TransactionCanceled(txHash)`                                       | `handleTransactionCanceled` | Marks the transaction `CANCELED`                                             |
| `TransactionExecuted(txHash, executor)`                             | `handleTransactionExecuted` | Marks the transaction `EXECUTED` and records executor + timestamp             |

### OracleManager

- **Address:** `0x0165878A594ca255338adfa4d48449f69242Eb8F`
- **Handler file:** `src/oracle-manager.ts`

| Event                                  | Handler             | Description                                                  |
| -------------------------------------- | ------------------- | ------------------------------------------------------------ |
| `PriceFeedSet(token, priceFeed, ...)`  | `handlePriceFeedSet`| Creates a `PaymentToken` (name + decimals) the first time seen |

---

## 3. Entity Reference

Numeric fields use `BigInt` (bignumber-safe and sortable; serialized as strings in query responses). State fields are GraphQL enums.

### `InvoiceEvent`

Immutable, append-only log row written by every handler. Each invoice's `events` field is derived from these. The `id` is `{txHash}-{logIndex}`.

| Field             | Type                        | Description                                                |
| ----------------- | --------------------------- | ---------------------------------------------------------- |
| `id`              | `ID!`                       | Composite key: `{txHash}-{logIndex}`                       |
| `eventType`       | `PaymentProcessorEventType!`| The event that produced this row (e.g. `INVOICE_PAID`)     |
| `txHash`          | `Bytes!`                    | Transaction hash of the event                              |
| `timestamp`       | `BigInt!`                   | Block timestamp                                            |
| `simpleInvoice`   | `SimplePaymentProcessor`    | Set for simple-processor events (else null)               |
| `advancedInvoice` | `AdvancedPaymentProcessor`  | Set for advanced-processor events (else null)             |

Processor-level events (e.g. `META_INVOICE_CREATED`, `ORACLE_UPDATED`) leave both invoice references null.

---

### `SimplePaymentProcessor`

One invoice on the SimplePaymentProcessor contract. The `id` is the on-chain `invoiceId` as a string.

| Field            | Type                          | Description                                                            |
| ---------------- | ----------------------------- | --------------------------------------------------------------------- |
| `id`             | `ID!`                         | On-chain invoice ID (numeric string)                                  |
| `invoiceNonce`   | `BigInt!`                     | Internal invoice nonce from the invoice struct                        |
| `state`          | `SimplePaymentProcessorState!`| Current lifecycle state (see [State Machine](#41-simple-payment-processor-states)) |
| `seller`         | `User!`                       | Seller who created the invoice                                        |
| `buyer`          | `User`                        | Buyer who paid (null until paid)                                      |
| `price`          | `BigInt!`                     | Invoice price in wei (ETH)                                            |
| `amountPaid`     | `BigInt`                      | Amount paid by the buyer in wei                                       |
| `invalidateAt`   | `BigInt`                      | Timestamp after which the invoice expires if unpaid                  |
| `expiresAt`      | `BigInt`                      | Timestamp after which the buyer's payment window closes              |
| `releaseAt`      | `BigInt`                      | Timestamp after which funds can be released (hold period)            |
| `fee`            | `BigInt`                      | Protocol fee deducted on acceptance, in wei                          |
| `contract`       | `Bytes!`                      | Address of the SimplePaymentProcessor contract                       |
| `events`         | `[InvoiceEvent!]!`            | Derived: append-only event log for this invoice                      |
| `lastActionTime` | `BigInt`                      | Block timestamp of the most recent state change                      |
| `buyerNote`      | `String`                      | Optional note left by the buyer                                      |
| `sellerNote`     | `String`                      | Optional note left by the seller                                     |

---

### `AdvancedPaymentProcessor`

One invoice on the AdvancedPaymentProcessor contract; supports multi-token payments and dispute resolution. The `id` is the on-chain `invoiceId`.

| Field                             | Type                            | Description                                                            |
| --------------------------------- | ------------------------------- | --------------------------------------------------------------------- |
| `id`                              | `ID!`                           | On-chain invoice ID (numeric string)                                  |
| `invoiceNonce`                    | `BigInt!`                       | Internal invoice nonce                                                |
| `state`                           | `AdvancedPaymentProcessorState!`| Current lifecycle state (see [State Machine](#42-advanced-payment-processor-states)) |
| `buyer`                           | `User`                          | Buyer address (null until paid)                                       |
| `seller`                          | `User!`                         | Seller address                                                        |
| `price`                           | `BigInt!`                       | Invoice price in the payment token's smallest unit                   |
| `escrow`                          | `Bytes`                         | Address of the deployed escrow contract holding funds                |
| `balance`                         | `BigInt`                        | Current escrow balance (decreases on partial refunds, zeroed on release/settle) |
| `paymentToken`                    | `PaymentToken`                  | ERC20 token used for payment (references `PaymentToken.id`)           |
| `releaseAt`                       | `BigInt`                        | Timestamp after which funds can be released                          |
| `amountReleased`                  | `BigInt`                        | Amount released to the seller                                        |
| `amountRefunded`                  | `BigInt`                        | Cumulative amount refunded to the buyer                             |
| `sellerAmountReceivedAfterDispute`| `BigInt`                        | Seller's share from a dispute settlement                            |
| `buyerAmountReceivedAfterDispute` | `BigInt`                        | Buyer's share from a dispute settlement                             |
| `amountPaid`                      | `BigInt`                        | Total amount paid by the buyer                                      |
| `contract`                        | `Bytes!`                        | Address of the AdvancedPaymentProcessor contract                    |
| `events`                          | `[InvoiceEvent!]!`              | Derived: append-only event log for this invoice                     |
| `fee`                             | `BigInt`                        | Protocol fee amount                                                 |
| `lastActionTime`                  | `BigInt`                        | Most recent state change timestamp                                 |
| `metaInvoice`                     | `MetaInvoice`                   | Parent meta-invoice, if this invoice is part of a batch            |
| `buyerNote`                       | `String`                        | Optional note left by the buyer                                    |
| `sellerNote`                      | `String`                        | Optional note left by the seller                                   |

---

### `MetaInvoice`

Groups one or more AdvancedPaymentProcessor invoices into a single payable unit. The `id` is the `metaInvoiceId`.

| Field          | Type                          | Description                                            |
| -------------- | ----------------------------- | ----------------------------------------------------- |
| `id`           | `ID!`                         | On-chain meta-invoice ID                              |
| `invoiceNonce` | `BigInt!`                     | The meta-invoice ID as a `BigInt`                     |
| `buyer`        | `User!`                       | Buyer (taken from the creating transaction's sender)  |
| `price`        | `BigInt!`                     | Total combined price across all sub-invoices          |
| `contract`     | `Bytes!`                      | Address of the AdvancedPaymentProcessor contract      |
| `invoices`     | `[AdvancedPaymentProcessor!]!`| Derived: child invoices linked via `metaInvoice`      |

---

### `User`

A unique wallet address that has interacted with either processor. The `id` is the hex address. A new `User` increments [`MetricData.newUsers`](#metricdata).

| Field                      | Type                           | Description                                       |
| -------------------------- | ------------------------------ | ------------------------------------------------- |
| `id`                       | `ID!`                          | Wallet address (hex string)                       |
| `ownedSimpleInvoices`      | `[SimplePaymentProcessor!]!`   | Derived: simple invoices where user is the seller |
| `paidSimpleInvoices`       | `[SimplePaymentProcessor!]!`   | Derived: simple invoices where user is the buyer  |
| `issuedAdvancedInvoices`   | `[AdvancedPaymentProcessor!]!` | Derived: advanced invoices where user is seller   |
| `receivedAdvancedInvoices` | `[AdvancedPaymentProcessor!]!` | Derived: advanced invoices where user is buyer    |
| `metaInvoices`             | `[MetaInvoice!]!`              | Derived: meta-invoices where user is buyer        |

---

### `PaymentToken`

Metadata for an ERC20 token that has a price feed (or the native ETH placeholder at the zero address). The `id` is the token's contract address (hex string). Created by `OracleManager.PriceFeedSet` and on first advanced payment.

| Field     | Type     | Description                                            |
| --------- | -------- | ----------------------------------------------------- |
| `id`      | `ID!`    | Token contract address (hex string; `0x0…0` for ETH)  |
| `name`    | `String` | Token name (or `"ETH"` for the native token)          |
| `decimal` | `Int`    | Token decimals from the ERC20 `decimals()` call       |

---

### `Note`

An encrypted note attached to a specific invoice. Immutable. The `id` is `{invoiceId}-{noteId}`.

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

| Field            | Type       | Description                                     |
| ---------------- | ---------- | ---------------------------------------------- |
| `id`             | `ID!`      | Composite key: `{invoiceId}-{noteId}-{address}`|
| `invoiceId`      | `BigInt!`  | The invoice this note belongs to               |
| `noteId`         | `BigInt!`  | The note index                                 |
| `user`           | `Bytes!`   | The user whose open state is recorded          |
| `opened`         | `Boolean!` | Whether the user has opened the note           |
| `updatedAtBlock` | `BigInt!`  | Block number of the last state change          |
| `updatedAtTx`    | `Bytes!`   | Transaction hash of the last state change      |

---

### `MultiSigWallet`

The indexed multisig contract. The `id` is the wallet's contract address. State is kept in sync via `try_*` view-call reads on every event.

| Field              | Type                      | Description                                              |
| ------------------ | ------------------------- | ------------------------------------------------------- |
| `id`               | `ID!`                     | Wallet contract address                                 |
| `threshold`        | `BigInt!`                 | Number of approvals required to execute a transaction   |
| `signerCount`      | `BigInt!`                 | Number of currently-active signers                      |
| `transactionCount` | `BigInt!`                 | On-chain nonce (total transactions ever proposed)       |
| `signers`          | `[MultiSigSigner!]!`      | Derived: all signers ever added (active or not)         |
| `transactions`     | `[MultiSigTransaction!]!` | Derived: all proposed transactions                      |

---

### `MultiSigSigner`

A signer record per `(wallet, signer address)`. Re-adding a removed signer reactivates the existing record. The `id` is `{walletAddress}-{signerAddress}`.

| Field       | Type                   | Description                                                   |
| ----------- | ---------------------- | ------------------------------------------------------------ |
| `id`        | `ID!`                  | Composite key: `{walletAddress}-{signerAddress}`             |
| `wallet`    | `MultiSigWallet!`      | The multisig wallet                                          |
| `address`   | `Bytes!`               | Signer address                                               |
| `active`    | `Boolean!`             | Whether the signer is currently active                       |
| `addedAt`   | `BigInt!`              | Timestamp of the most recent `SignerAdded`                   |
| `removedAt` | `BigInt`               | Timestamp of the most recent `SignerRemoved` (null if active)|
| `approvals` | `[MultiSigApproval!]!` | Derived: every approval this signer has cast                 |

---

### `MultiSigTransaction`

A proposed multisig call. The `id` is the on-chain `txHash` (bytes32).

| Field           | Type                   | Description                                                          |
| --------------- | ---------------------- | ------------------------------------------------------------------- |
| `id`            | `Bytes!`               | `txHash` of the proposal                                            |
| `wallet`        | `MultiSigWallet!`      | The multisig that owns this proposal                                |
| `target`        | `Bytes!`               | Contract / EOA the call is directed at                              |
| `value`         | `BigInt!`              | Native value attached to the call                                   |
| `data`          | `Bytes!`               | Calldata for the proposed call                                      |
| `nonce`         | `BigInt!`              | Wallet nonce assigned at proposal time                              |
| `proposer`      | `Bytes!`               | Signer that proposed the transaction                                |
| `status`        | `MultisigStatus!`      | Lifecycle state (see [MultiSig States](#43-multisig-transaction-states)) |
| `approvalCount` | `BigInt!`              | Current number of approvals                                         |
| `proposedAt`    | `BigInt!`              | Block timestamp of `TransactionProposed`                            |
| `executedAt`    | `BigInt`               | Block timestamp of `TransactionExecuted` (null until executed)      |
| `executor`      | `Bytes`                | Address that executed the transaction                               |
| `approvals`     | `[MultiSigApproval!]!` | Derived: per-signer approval records                                |

---

### `MultiSigApproval`

One record per `(txHash, approver)` approval. The `id` is `{txHash}-{approverAddress}`.

| Field           | Type                   | Description                                                             |
| --------------- | ---------------------- | ---------------------------------------------------------------------- |
| `id`            | `ID!`                  | Composite key: `{txHash}-{approverAddress}`                            |
| `transaction`   | `MultiSigTransaction!` | The transaction being approved                                         |
| `signer`        | `MultiSigSigner`       | The signer record (null if the approver has no `MultiSigSigner` entity)|
| `approver`      | `Bytes!`               | Approver address (raw, even when no signer record exists)              |
| `approvalCount` | `BigInt!`              | Running approval count at the time of this approval                    |
| `approvedAt`    | `BigInt!`              | Block timestamp of the `ApprovalAdded` event                           |

---

### Metrics entities

See [Dashboard Metrics](#5-dashboard-metrics) for `MetricData`, `TokenMetric`, `RecentTransaction`, and `GasPaid`.

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
  accepts   rejects     refunded
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
   │  ┌───────┼───────────────┐
   │  │       │               │
   │ admin  admin            admin
   │dismiss resolve          settle
   │  │       │               │
   │  ▼       ▼               ▼
   │ DISPUTE_  DISPUTE_     DISPUTE_
   │DISMISSED  RESOLVED     SETTLED
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
| `DISPUTE_DISMISSED` | Admin dismissed the dispute; invoice returns to normal flow   |
| `DISPUTE_RESOLVED`  | Admin resolved the dispute in one party's favor               |
| `DISPUTE_SETTLED`   | Admin split the funds between buyer and seller                |
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

| State      | Meaning                                      |
| ---------- | -------------------------------------------- |
| `PROPOSED` | Transaction proposed; awaiting approvals     |
| `APPROVED` | Approval threshold reached; ready to execute |
| `EXECUTED` | Transaction has been executed on-chain       |
| `CANCELED` | Transaction was canceled before execution    |

---

## 5. Dashboard Metrics

A small set of global aggregates power the dashboard. They are maintained inside the invoice handlers via `src/util/metrics.ts`. Because mutable entities are versioned per block, windowed / historical views (e.g. 30-day volume) are computed on the client with time-travel (`block: { number }`) queries against these entities. See `rev/first-section-metrics.md` for the full spec.

### `MetricData`

Singleton (`id: "global"`) holding the consolidated counters.

| Field                        | Type             | Description                                              |
| ---------------------------- | ---------------- | ------------------------------------------------------- |
| `id`                         | `ID!`            | Always `"global"`                                       |
| `paidInvoices`               | `BigInt!`        | Currently-paid, unsettled invoice count                 |
| `lastPaidInvoiceTimestamp`   | `BigInt!`        | Timestamp of the most recent payment/settlement mutation|
| `simpleTransactionCount`     | `BigInt!`        | Daily simple-processor activity counter (24h reset)     |
| `advancedTransactionCount`   | `BigInt!`        | Daily advanced-processor activity counter (24h reset)   |
| `transactionCountLastUpdate` | `BigInt!`        | Timestamp anchor for the daily reset                    |
| `newUsers`                   | `BigInt!`        | Cumulative count of unique users ever seen              |
| `activeUsers`                | `BigInt!`        | Activity counter that resets every 24h (see note)       |
| `activeUsersLastUpdate`      | `BigInt!`        | Timestamp anchor for the active-users reset             |
| `tokenData`                  | `[TokenMetric!]!`| Derived: per-token volume / escrow / fees               |

> **Note:** `activeUsers` counts activity events in the 24h window, not unique addresses. True uniqueness would require a per-user `lastActive` field.

### `TokenMetric`

Per-token aggregates in raw token units. The `id` is the token address (matches `PaymentToken.id`). USD conversion happens at read time on the client.

| Field           | Type           | Description                                          |
| --------------- | -------------- | --------------------------------------------------- |
| `id`            | `ID!`          | Token address                                       |
| `metric`        | `MetricData!`  | Back-reference to the singleton                     |
| `token`         | `PaymentToken!`| The token                                           |
| `volumeBalance` | `BigInt!`      | Cumulative volume; never reversed on settlement     |
| `escrowBalance` | `BigInt!`      | Live escrow: `+=` on Paid, `-=` on settlement       |
| `feeBalance`    | `BigInt!`      | Cumulative protocol fees collected                  |

### `RecentTransaction`

Immutable, append-only. Query `first: 5, orderBy: timestamp, orderDirection: desc`. The `id` is `{txHash}-{logIndex}`.

| Field             | Type           | Description                                  |
| ----------------- | -------------- | -------------------------------------------- |
| `id`              | `ID!`          | Composite key: `{txHash}-{logIndex}`         |
| `transactionHash` | `Bytes!`       | For building the block-explorer link         |
| `timestamp`       | `BigInt!`      | Block timestamp                              |
| `amount`          | `BigInt!`      | Signed: positive on payment, negative on release |
| `token`           | `PaymentToken` | Token of the amount (for USD conversion)     |

### `GasPaid`

Singleton (`id: "global"`) tracking gas spent on platform-initiated advanced actions (every advanced action **except** payment).

| Field              | Type      | Description                                                   |
| ------------------ | --------- | ------------------------------------------------------------ |
| `id`               | `ID!`     | Always `"global"`                                            |
| `amount`           | `BigInt!` | Cumulative gas cost, approximated as `gasLimit × gasPrice`   |
| `transactionCount` | `BigInt!` | Number of gas-incurring actions recorded                     |
| `lastTimeStamp`    | `BigInt!` | Timestamp of the most recent recorded action                |

> **Note:** `amount` uses `gasLimit × gasPrice` (the gas budget). Exact `gasUsed` would require enabling `receipt: true` on the advanced handlers.

---

## 6. Example Queries

Local endpoint: `http://localhost:8000/subgraphs/name/payment-processor`

### Fetch recent simple invoices with their event log

```graphql
{
  simplePaymentProcessors(
    first: 10
    orderBy: lastActionTime
    orderDirection: desc
  ) {
    id
    state
    price
    amountPaid
    fee
    releaseAt
    seller { id }
    buyer { id }
    events(orderBy: timestamp) {
      eventType
      timestamp
      txHash
    }
  }
}
```

### Fetch all invoices for a specific user

```graphql
{
  user(id: "0xabc123...") {
    ownedSimpleInvoices {
      id
      state
      price
      buyer { id }
    }
    issuedAdvancedInvoices {
      id
      state
      price
      paymentToken { name decimal }
      buyer { id }
    }
  }
}
```

### Fetch active disputes

```graphql
{
  advancedPaymentProcessors(
    where: { state: DISPUTED }
    orderBy: lastActionTime
    orderDirection: desc
  ) {
    id
    invoiceNonce
    seller { id }
    buyer { id }
    balance
    paymentToken { id name }
    events(orderBy: timestamp) {
      eventType
      timestamp
    }
  }
}
```

### Fetch a meta-invoice and its child invoices

```graphql
{
  metaInvoice(id: "42") {
    id
    price
    contract
    buyer { id }
    invoices {
      id
      state
      price
    }
  }
}
```

### Dashboard metrics

```graphql
{
  metricData(id: "global") {
    paidInvoices
    newUsers
    activeUsers
    simpleTransactionCount
    advancedTransactionCount
    tokenData {
      token { name decimal }
      volumeBalance
      escrowBalance
      feeBalance
    }
  }
  recentTransactions(first: 5, orderBy: timestamp, orderDirection: desc) {
    transactionHash
    amount
    timestamp
    token { name }
  }
  gasPaid(id: "global") {
    amount
    transactionCount
    lastTimeStamp
  }
}
```

### Time-travel: volume 30 days ago

Resolve the block number for the target timestamp off-chain (e.g. a block-by-timestamp service), then query at that block:

```graphql
{
  metricData(id: "global", block: { number: 1234567 }) {
    tokenData {
      token { name }
      volumeBalance
    }
  }
}
```

### Fetch notes for an invoice

```graphql
{
  notes(where: { invoiceId: "7" }, orderBy: noteId) {
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
  multiSigWallet(id: "0x5fbdb2315678afecb367f032d93f642f64180aa3") {
    threshold
    signerCount
    transactionCount
    signers(where: { active: true }) {
      address
      addedAt
    }
    transactions(
      where: { status: PROPOSED }
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
