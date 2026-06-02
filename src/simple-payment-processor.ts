import { Address, BigInt, ethereum } from "@graphprotocol/graph-ts";
import {
  InvoiceAccepted as InvoiceAcceptedEvent,
  InvoiceCanceled as InvoiceCanceledEvent,
  InvoiceCreated as InvoiceCreatedEvent,
  InvoicePaid as InvoicePaidEvent,
  InvoiceRefunded as InvoiceRefundedEvent,
  InvoiceRejected as InvoiceRejectedEvent,
  InvoiceReleased as InvoiceReleasedEvent,
  LockedPaymentRecovered as LockedPaymentRecoveredEvent,
  TransferFailed as TransferFailedEvent,
  UpdateHoldPeriod as UpdateHoldPeriodEvent,
  WithdrawalRetried as WithdrawalRetriedEvent,
} from "../generated/SimplePaymentProcessor/SimplePaymentProcessor";
import { InvoiceEvent, SimplePaymentProcessor, User } from "../generated/schema";
import { getDefaultHoldPeriod, getFee } from "./util/storage";
import {
  addRecentTransaction,
  recordActiveUser,
  recordActivity,
  recordFee,
  recordNewUser,
  recordPayment,
  recordSettlement,
  SIMPLE,
} from "./util/metrics";

// Simple invoices are settled in the native token (ETH).
const ETH = Address.zero();
const ZERO = BigInt.fromI32(0);

const CREATED = "CREATED";
const PAID = "PAID";
const ACCEPTED = "ACCEPTED";
const CANCELED = "CANCELED";
const RELEASED = "RELEASED";
const REJECTED = "REJECTED";
const REFUNDED = "REFUNDED";
const INVOICE_ACCEPTED = "INVOICE_ACCEPTED";
const INVOICE_CANCELED = "INVOICE_CANCELED";
const INVOICE_CREATED = "INVOICE_CREATED";
const INVOICE_PAID = "INVOICE_PAID";
const INVOICE_REFUNDED = "INVOICE_REFUNDED";
const INVOICE_REJECTED = "INVOICE_REJECTED";
const INVOICE_RELEASED = "INVOICE_RELEASED";
const LOCKED_PAYMENT_RECOVERED = "LOCKED_PAYMENT_RECOVERED";
const TRANSFER_FAILED = "TRANSFER_FAILED";
const UPDATE_HOLD_PERIOD = "UPDATE_HOLD_PERIOD";
const WITHDRAWAL_RETRIED = "WITHDRAWAL_RETRIED";

function getOrCreateUser(id: string): User {
  let user = User.load(id);
  if (user) return user;

  user = new User(id);
  user.save();
  recordNewUser();

  return user;
}

function eventId(event: ethereum.Event): string {
  return event.transaction.hash.toHex() + "-" + event.logIndex.toString();
}

function saveInvoiceEvent(
  event: ethereum.Event,
  invoiceId: string,
  eventType: string
): void {
  const invoiceEvent = new InvoiceEvent(eventId(event));
  invoiceEvent.eventType = eventType;
  invoiceEvent.txHash = event.transaction.hash;
  invoiceEvent.timestamp = event.block.timestamp;
  invoiceEvent.simpleInvoice = invoiceId;
  invoiceEvent.save();

  recordActivity(SIMPLE, event.block.timestamp);
}


function isEscrowed(state: string): boolean {
  return state == PAID || state == ACCEPTED;
}


function settleSimple(
  invoice: SimplePaymentProcessor,
  decrementPaid: boolean,
  timestamp: BigInt
): void {
  if (invoice.amountPaid === null) return;
  recordSettlement(ETH, invoice.amountPaid!, decrementPaid, timestamp);
}

export function handleInvoiceCreated(event: InvoiceCreatedEvent): void {
  const id = event.params.invoiceId.toString();
  const invoice = new SimplePaymentProcessor(id);

  const sellerId = event.params.invoice.seller.toHex();
  getOrCreateUser(sellerId);

  invoice.invoiceNonce = event.params.invoice.invoiceNonce;
  invoice.seller = sellerId;
  invoice.state = CREATED;
  invoice.price = event.params.invoice.price;
  invoice.contract = event.address;
  invoice.lastActionTime = event.block.timestamp;
  invoice.invalidateAt = event.params.invoice.invalidateAt;

  invoice.save();
  saveInvoiceEvent(event, id, INVOICE_CREATED);
}

export function handleHoldPeriod(event: UpdateHoldPeriodEvent): void {
  const id = event.params.invoiceId.toString();
  const invoice = SimplePaymentProcessor.load(id);
  if (!invoice) return;

  invoice.releaseAt = event.params.releaseDueTimestamp;
  invoice.lastActionTime = event.block.timestamp;
  invoice.save();
  saveInvoiceEvent(event, id, UPDATE_HOLD_PERIOD);
}

export function handleInvoicePaid(event: InvoicePaidEvent): void {
  const id = event.params.invoiceId.toString();
  const invoice = SimplePaymentProcessor.load(id);
  if (!invoice) return;

  const buyerId = event.params.buyer.toHex();
  getOrCreateUser(buyerId);

  invoice.buyer = buyerId;
  invoice.state = PAID;
  invoice.amountPaid = event.params.amountPaid;
  invoice.lastActionTime = event.block.timestamp;
  invoice.expiresAt = event.params.expiresAt;

  invoice.save();
  saveInvoiceEvent(event, id, INVOICE_PAID);

  recordPayment(ETH, event.params.amountPaid, event.block.timestamp);
  recordActiveUser(event.block.timestamp);
  addRecentTransaction(event, event.params.amountPaid, ETH);
}

export function handleInvoiceAccepted(event: InvoiceAcceptedEvent): void {
  const id = event.params.invoiceId.toString();
  const invoice = SimplePaymentProcessor.load(id);
  if (!invoice) return;

  const fee = getFee(invoice.amountPaid!);
  invoice.fee = fee;
  invoice.state = ACCEPTED;
  invoice.lastActionTime = event.block.timestamp;

  if (!invoice.releaseAt) {
    invoice.releaseAt = event.block.timestamp.plus(getDefaultHoldPeriod());
  }

  invoice.save();
  saveInvoiceEvent(event, id, INVOICE_ACCEPTED);

  recordFee(ETH, fee);
}

export function handleInvoiceCanceled(event: InvoiceCanceledEvent): void {
  const id = event.params.invoiceId.toString();
  const invoice = SimplePaymentProcessor.load(id);
  if (!invoice) return;

  invoice.state = CANCELED;
  invoice.lastActionTime = event.block.timestamp;

  invoice.save();
  saveInvoiceEvent(event, id, INVOICE_CANCELED);
}

export function handleInvoiceRefunded(event: InvoiceRefundedEvent): void {
  const id = event.params.invoiceId.toString();
  const invoice = SimplePaymentProcessor.load(id);
  if (!invoice) return;

  const wasPaid = isEscrowed(invoice.state);
  invoice.state = REFUNDED;
  invoice.lastActionTime = event.block.timestamp;

  invoice.save();
  saveInvoiceEvent(event, id, INVOICE_REFUNDED);
  settleSimple(invoice, wasPaid, event.block.timestamp);
}

export function handleInvoiceRejected(event: InvoiceRejectedEvent): void {
  const id = event.params.invoiceId.toString();
  const invoice = SimplePaymentProcessor.load(id);
  if (!invoice) return;

  const wasPaid = isEscrowed(invoice.state);
  invoice.state = REJECTED;
  invoice.lastActionTime = event.block.timestamp;

  invoice.save();
  saveInvoiceEvent(event, id, INVOICE_REJECTED);
  settleSimple(invoice, wasPaid, event.block.timestamp);
}

export function handleInvoiceReleased(event: InvoiceReleasedEvent): void {
  const id = event.params.invoiceId.toString();
  const invoice = SimplePaymentProcessor.load(id);
  if (!invoice) return;

  const wasPaid = isEscrowed(invoice.state);
  invoice.state = RELEASED;
  invoice.lastActionTime = event.block.timestamp;

  invoice.save();
  saveInvoiceEvent(event, id, INVOICE_RELEASED);
  settleSimple(invoice, wasPaid, event.block.timestamp);
  if (invoice.amountPaid !== null) {
    addRecentTransaction(event, ZERO.minus(invoice.amountPaid!), ETH);
  }
}

export function handleLockedPaymentRecovered(
  event: LockedPaymentRecoveredEvent
): void {
  const id = event.params.invoiceId.toString();
  const invoice = SimplePaymentProcessor.load(id);
  if (!invoice) return;

  invoice.lastActionTime = event.block.timestamp;
  invoice.save();
  saveInvoiceEvent(event, id, LOCKED_PAYMENT_RECOVERED);
}

export function handleTransferFailed(event: TransferFailedEvent): void {
  const id = event.params.invoiceId.toString();
  const invoice = SimplePaymentProcessor.load(id);
  if (!invoice) return;

  invoice.lastActionTime = event.block.timestamp;
  invoice.save();
  saveInvoiceEvent(event, id, TRANSFER_FAILED);
}

export function handleWithdrawalRetried(event: WithdrawalRetriedEvent): void {
  const id = event.params.invoiceId.toString();
  const invoice = SimplePaymentProcessor.load(id);
  if (!invoice) return;

  invoice.lastActionTime = event.block.timestamp;
  invoice.save();
  saveInvoiceEvent(event, id, WITHDRAWAL_RETRIED);
}
