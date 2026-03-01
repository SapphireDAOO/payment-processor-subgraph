import { BigInt } from "@graphprotocol/graph-ts";
import {
  InvoiceAccepted as InvoiceAcceptedEvent,
  InvoiceCanceled as InvoiceCanceledEvent,
  InvoiceCreated as InvoiceCreatedEvent,
  InvoicePaid as InvoicePaidEvent,
  InvoiceRefunded as InvoiceRefundedEvent,
  InvoiceRejected as InvoiceRejectedEvent,
  InvoiceReleased as InvoiceReleasedEvent,
  UpdateHoldPeriod as UpdateHoldPeriodEvent,
} from "../generated/SimplePaymentProcessor/SimplePaymentProcessor";
import { SimplePaymentProcessor, InvoiceType, User } from "../generated/schema";
import { getDefaultHoldPeriod, getFee } from "./util/storage";

const CREATED = "CREATED";
const PAID = "PAID";
const ACCEPTED = "ACCEPTED";
const CANCELED = "CANCELED";
const RELEASED = "RELEASED";
const REJECTED = "REJECTED";
const REFUNDED = "REFUNDED";

function getOrCreateUser(id: string): User {
  let user = User.load(id);
  if (user) return user;

  user = new User(id);
  user.save();

  return user;
}

function addHistory(
  entity: SimplePaymentProcessor,
  status: string,
  timestamp: BigInt
): void {
  const historyValue = entity.get("history");
  const history = historyValue
    ? historyValue.toStringArray()
    : new Array<string>();
  history.push(status);
  entity.history = history;

  const historyTimeValue = entity.get("historyTime");
  const historyTime = historyTimeValue
    ? historyTimeValue.toStringArray()
    : new Array<string>();
  historyTime.push(timestamp.toString());
  entity.historyTime = historyTime;
}

export function handleInvoiceCreated(event: InvoiceCreatedEvent): void {
  const id = event.params.orderId.toString();
  let invoice = SimplePaymentProcessor.load(id);
  if (!invoice) {
    invoice = new SimplePaymentProcessor(id);
    addHistory(invoice, CREATED, event.block.timestamp);
  }

  const invoiceType = new InvoiceType(id);
  invoiceType.type = "SimplePaymentProcessor";

  const sellerId = event.params.invoice.seller.toHex();
  getOrCreateUser(sellerId);

  invoice.invoiceId = event.params.invoice.invoiceId.toString();
  invoice.seller = sellerId;
  invoice.state = CREATED;
  invoice.createdAt = event.block.timestamp;
  invoice.price = event.params.invoice.price;
  invoice.contract = event.address;
  invoice.creationTxHash = event.transaction.hash.toHex();
  invoice.lastActionTime = event.block.timestamp;
  invoice.invalidateAt = event.params.invalidateAt;

  invoiceType.save();
  invoice.save();
}

export function handleHoldPeriod(event: UpdateHoldPeriodEvent): void {
  const id = event.params.orderId.toString();
  const invoice = SimplePaymentProcessor.load(id);
  if (!invoice) return;

  invoice.releasedAt = event.params.releaseDueTimestamp;
  invoice.lastActionTime = event.block.timestamp;
  invoice.save();
}

export function handleInvoicePaid(event: InvoicePaidEvent): void {
  const id = event.params.orderId.toString();
  const invoice = SimplePaymentProcessor.load(id);
  if (!invoice) return;

  const buyerId = event.params.buyer.toHex();
  getOrCreateUser(buyerId);

  invoice.buyer = buyerId;
  invoice.paidAt = event.block.timestamp;
  invoice.state = PAID;
  invoice.amountPaid = event.params.amountPaid;
  invoice.paymentTxHash = event.transaction.hash;
  invoice.lastActionTime = event.block.timestamp;
  invoice.expiresAt = event.params.expiresAt;

  addHistory(invoice, PAID, event.block.timestamp);

  invoice.save();
}

export function handleInvoiceAccepted(event: InvoiceAcceptedEvent): void {
  const id = event.params.orderId.toString();
  const invoice = SimplePaymentProcessor.load(id);
  if (!invoice) return;

  invoice.commissionTxHash = event.transaction.hash;

  if (!invoice.releasedAt) {
    invoice.releasedAt = event.block.timestamp.plus(getDefaultHoldPeriod());
  }

  invoice.fee = getFee(invoice.amountPaid!);
  invoice.state = ACCEPTED;
  invoice.lastActionTime = event.block.timestamp;

  addHistory(invoice, ACCEPTED, event.block.timestamp);

  invoice.save();
}

export function handleInvoiceCanceled(event: InvoiceCanceledEvent): void {
  const id = event.params.orderId.toString();
  const invoice = SimplePaymentProcessor.load(id);
  if (!invoice) return;

  invoice.state = CANCELED;
  invoice.lastActionTime = event.block.timestamp;

  addHistory(invoice, CANCELED, event.block.timestamp);

  invoice.save();
}

export function handleInvoiceRefunded(event: InvoiceRefundedEvent): void {
  const id = event.params.orderId.toString();
  const invoice = SimplePaymentProcessor.load(id);
  if (!invoice) return;

  invoice.state = REFUNDED;
  invoice.refundTxHash = event.transaction.hash;
  invoice.lastActionTime = event.block.timestamp;

  addHistory(invoice, REFUNDED, event.block.timestamp);

  invoice.save();
}

export function handleInvoiceRejected(event: InvoiceRejectedEvent): void {
  const id = event.params.orderId.toString();
  const invoice = SimplePaymentProcessor.load(id);
  if (!invoice) return;

  invoice.state = REJECTED;
  invoice.lastActionTime = event.block.timestamp;
  invoice.refundTxHash = event.transaction.hash;

  addHistory(invoice, REJECTED, event.block.timestamp);

  invoice.save();
}

export function handleInvoiceReleased(event: InvoiceReleasedEvent): void {
  const id = event.params.orderId.toString();
  const invoice = SimplePaymentProcessor.load(id);
  if (!invoice) return;

  invoice.state = RELEASED;
  invoice.lastActionTime = event.block.timestamp;
  invoice.releaseHash = event.transaction.hash;

  addHistory(invoice, RELEASED, event.block.timestamp);

  invoice.save();
}
