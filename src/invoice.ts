import { Address, Bytes } from "@graphprotocol/graph-ts";
import {
  InvoiceAccepted as InvoiceAcceptedEvent,
  InvoiceCanceled as InvoiceCanceledEvent,
  InvoiceCreated as InvoiceCreatedEvent,
  InvoicePaid as InvoicePaidEvent,
  InvoiceRefunded as InvoiceRefundedEvent,
  InvoiceRejected as InvoiceRejectedEvent,
  InvoiceReleased as InvoiceReleasedEvent,
  PaymentProcessorV1,
  UpdateHoldPeriod as UpdateHoldPeriodEvent,
} from "../generated/PaymentProcessorV1/PaymentProcessorV1";
import { Invoice, User } from "../generated/schema";
import { SIMPLE_PAYMENT_PROCESSOR_CONTRACT_ADDRESS } from "./util/constant";

export function handleInvoiceCreated(event: InvoiceCreatedEvent): void {
  let id = "invoice-" + event.params.invoice.invoiceId.toString();
  let entity = new Invoice(id);

  let sellerId = event.params.invoice.seller.toHex();
  let seller = User.load(sellerId);
  if (!seller) {
    seller = new User(sellerId);
    seller.save();
  }

  entity.invoiceId = getInvoiceId(event.params.invoiceKey);
  entity.seller = sellerId;
  entity.state = "CREATED";
  entity.createdAt = event.block.timestamp;
  entity.price = event.params.invoice.price;
  entity.contract = event.address;

  entity.save();
}

export function handleHoldPeriod(event: UpdateHoldPeriodEvent): void {
  let id = "invoice-" + getInvoiceId(event.params.invoiceKey);
  let entity = Invoice.load(id);
  if (!entity) return;

  entity.releasedAt = event.params.releaseDueTimestamp;
  entity.save();
}

export function handleInvoicePaid(event: InvoicePaidEvent): void {
  let id = "invoice-" + getInvoiceId(event.params.invoiceKey);
  let entity = Invoice.load(id);
  if (!entity) return;

  let buyerId = event.params.buyer.toHex();
  let buyer = User.load(buyerId);
  if (!buyer) {
    buyer = new User(buyerId);
    buyer.save();
  }

  entity.buyer = buyerId;
  entity.paidAt = event.block.timestamp;
  entity.state = "PAID";
  entity.amountPaid = event.params.amountPaid;
  entity.paymentTxHash = event.transaction.hash;

  entity.save();
}

export function handleInvoiceAccepted(event: InvoiceAcceptedEvent): void {
  const simplePP = PaymentProcessorV1.bind(
    Address.fromString(SIMPLE_PAYMENT_PROCESSOR_CONTRACT_ADDRESS)
  );
  const invoiceKey = event.params.invoiceKey;

  let id =
    "invoice-" + simplePP.getInvoiceData(invoiceKey).invoiceId.toString();
  let entity = Invoice.load(id);
  if (!entity) return;

  const result = simplePP.getInvoiceData(invoiceKey);
  const fee = simplePP.calculateFee(result.price);

  if (!entity.releasedAt) {
    entity.releasedAt = event.block.timestamp.plus(
      simplePP.getDefaultHoldPeriod()
    );
  }

  entity.fee = fee;
  entity.state = "ACCEPTED";
  entity.save();
}

export function handleInvoiceCanceled(event: InvoiceCanceledEvent): void {
  let id = "invoice-" + getInvoiceId(event.params.invoiceKey);
  let entity = Invoice.load(id);
  if (!entity) return;

  entity.state = "CANCELED";
  entity.save();
}

export function handleInvoiceRefunded(event: InvoiceRefundedEvent): void {
  let id = "invoice-" + getInvoiceId(event.params.invoiceKey);
  let entity = Invoice.load(id);
  if (!entity) return;

  entity.state = "REFUNDED";
  entity.save();
}

export function handleInvoiceRejected(event: InvoiceRejectedEvent): void {
  let id = "invoice-" + getInvoiceId(event.params.invoiceKey);
  let entity = Invoice.load(id);
  if (!entity) return;

  entity.state = "REJECTED";
  entity.save();
}

export function handleInvoiceReleased(event: InvoiceReleasedEvent): void {
  let id = "invoice-" + getInvoiceId(event.params.invoiceKey);
  let entity = Invoice.load(id);
  if (!entity) return;

  entity.state = "RELEASED";
  entity.releaseHash = event.transaction.hash;
  entity.save();
}

function getInvoiceId(invoiceKey: Bytes): string {
  const simplePP = PaymentProcessorV1.bind(
    Address.fromString(SIMPLE_PAYMENT_PROCESSOR_CONTRACT_ADDRESS)
  );
  return simplePP.getInvoiceData(invoiceKey).invoiceId.toString();
}
