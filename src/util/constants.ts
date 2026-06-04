import { Address, BigInt } from "@graphprotocol/graph-ts";

// Numeric helpers
export const ZERO = BigInt.fromI32(0);
export const ONE = BigInt.fromI32(1);
export const SECONDS_PER_DAY = BigInt.fromI32(86400);

// Native token (ETH): simple-processor escrow and the zero-address PaymentToken.
export const ETH = Address.zero();

// Id of the GasPaid singleton.
export const GLOBAL = "global";

// Placeholder id for timeseries points; graph-node overrides id and timestamp.
export const TS_ID = 0;

// SimplePaymentProcessorState / AdvancedPaymentProcessorState values
export const CREATED = "CREATED";
export const PAID = "PAID";
export const ACCEPTED = "ACCEPTED";
export const CANCELED = "CANCELED";
export const RELEASED = "RELEASED";
export const REJECTED = "REJECTED";
export const REFUNDED = "REFUNDED";
export const DISPUTED = "DISPUTED";
export const DISPUTE_DISMISSED = "DISPUTE_DISMISSED";
export const DISPUTE_RESOLVED = "DISPUTE_RESOLVED";
export const DISPUTE_SETTLED = "DISPUTE_SETTLED";

// PaymentProcessorEventType values
export const INVOICE_CREATED = "INVOICE_CREATED";
export const INVOICE_PAID = "INVOICE_PAID";
export const INVOICE_ACCEPTED = "INVOICE_ACCEPTED";
export const INVOICE_CANCELED = "INVOICE_CANCELED";
export const INVOICE_REFUNDED = "INVOICE_REFUNDED";
export const INVOICE_REJECTED = "INVOICE_REJECTED";
export const INVOICE_RELEASED = "INVOICE_RELEASED";
export const DISPUTE_CREATED = "DISPUTE_CREATED";
export const DISPUTE_DISMISSED_EVENT = "DISPUTE_DISMISSED";
export const DISPUTE_RESOLVED_EVENT = "DISPUTE_RESOLVED";
export const DISPUTE_SETTLED_EVENT = "DISPUTE_SETTLED";
export const ESCROW_CREATED = "ESCROW_CREATED";
export const LOCKED_PAYMENT_RECOVERED = "LOCKED_PAYMENT_RECOVERED";
export const META_INVOICE_CREATED = "META_INVOICE_CREATED";
export const ORACLE_UPDATED = "ORACLE_UPDATED";
export const PAYMENT_RELEASED = "PAYMENT_RELEASED";
export const TRANSFER_FAILED = "TRANSFER_FAILED";
export const UPDATE_HOLD_PERIOD = "UPDATE_HOLD_PERIOD";
export const UPDATE_RELEASE_TIME = "UPDATE_RELEASE_TIME";
export const WITHDRAWAL_RETRIED = "WITHDRAWAL_RETRIED";

// InvoiceType values
export const SIMPLE = "SIMPLE";
export const ADVANCED = "ADVANCED";

// UserRole values
export const CREATOR = "CREATOR";
export const PAYER = "PAYER";

// MultisigStatus values
export const STATUS_PROPOSED = "PROPOSED";
export const STATUS_APPROVED = "APPROVED";
export const STATUS_CANCELED = "CANCELED";
export const STATUS_EXECUTED = "EXECUTED";
