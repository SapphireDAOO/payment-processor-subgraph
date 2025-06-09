import {
  InvoiceAccepted as InvoiceAcceptedEvent,
  InvoiceCreated as InvoiceCreatedEvent,
  InvoiceRejected as InvoiceRejectedEvent,
  MetaInvoiceCreated as MetaInvoiceCreatedEvent,
  DisputeCreated as DisputeCreatedEvent,
  DisputeDismissed as DisputeDismissedEvent,
  DisputeResolved as DisputeResolvedEvent,
  DisputeSettled as DisputeSettledEvent,
  CancelationRequested as CancelationRequestedEvent,
  CancelationRequestHandled as CancelationRequestHandledEvent,
  ExpiredInvoiceRefunded as ExpiredInvoiceRefundedEvent,
  PaymentReleased as PaymentReleasedEvent,
  InvoicePaid as InvoicePaidV2Event,
  InvoiceCanceled as InvoiceCanceledEvent,
} from "../generated/AdvancedPaymentProcessor/AdvancedPaymentProcessor";

import { SmartInvoice, MetaInvoice, User } from "../generated/schema";

export function handleSmartInvoiceCreated(event: InvoiceCreatedEvent): void {
  const invoiceId = event.params.invoice.invoiceId.toString();
  let id = event.params.invoiceKey.toHex();
  let invoice = SmartInvoice.load(id);

  if (!invoice) {
    invoice = new SmartInvoice(id);
  }

  let buyerId = event.params.invoice.buyer.toHex();
  let sellerId = event.params.invoice.seller.toHex();

  let buyer = User.load(buyerId);
  if (!buyer) {
    buyer = new User(buyerId);
    buyer.save();
  }

  let seller = User.load(sellerId);
  if (!seller) {
    seller = new User(sellerId);
    seller.save();
  }

  invoice.invoiceId = invoiceId;
  invoice.buyer = buyerId;
  invoice.seller = sellerId;
  invoice.createdAt = event.block.timestamp;
  invoice.state = "CREATED";
  invoice.price = event.params.invoice.price;
  invoice.contract = event.address;
  invoice.expiresAt = event.block.timestamp.plus(
    event.params.invoice.invoiceExpiryDuration
  );
  invoice.cancelAt = event.params.invoice.timeBeforeCancelation;
  invoice.releasedAt = event.params.invoice.releaseWindow;
  invoice.metaInvoice = event.params.invoice.metaInvoiceKey.toHex();

  invoice.save();
}

export function handleMetaInvoiceCreated(event: MetaInvoiceCreatedEvent): void {
  const invoiceId = event.params.metaInvoice.invoiceId.toString();
  let id = event.params.metaInvoiceKey.toHex();
  let meta = new MetaInvoice(id);

  let buyerId = event.params.metaInvoice.buyer.toHex();
  let buyer = User.load(buyerId);
  if (!buyer) {
    buyer = new User(buyerId);
    buyer.save();
  }

  meta.invoiceId = invoiceId;
  meta.buyer = buyerId;
  meta.price = event.params.metaInvoice.price;
  meta.contract = event.address;
  meta.save();
}

export function handleInvoicePaid(event: InvoicePaidV2Event): void {
  let id = event.params.invoiceKey.toHex();
  let invoice = SmartInvoice.load(id);
  if (!invoice) return;

  invoice.paidAt = event.block.timestamp;
  invoice.amountPaid = event.params.amount;
  invoice.paymentToken = event.params.paymentToken;
  invoice.state = "PAID";
  invoice.cancelAt = invoice.cancelAt!.plus(event.block.timestamp);
  invoice.escrow = event.params.escrowAddress;
  invoice.save();
}

export function handleInvoiceAccepted(event: InvoiceAcceptedEvent): void {
  let id = event.params.invoiceKey.toHex();
  let invoice = SmartInvoice.load(id);
  if (!invoice) return;

  invoice.state = "ACCEPTED";
  invoice.releasedAt = invoice.releasedAt!.plus(event.block.timestamp);
  invoice.save();
}

export function handleInvoiceCanceled(event: InvoiceCanceledEvent): void {
  let id = event.params.invoiceKey.toHex();
  let invoice = SmartInvoice.load(id);
  if (!invoice) return;

  invoice.state = "CANCELED";
  invoice.save();
}

export function handleInvoiceRejected(event: InvoiceRejectedEvent): void {
  let id = event.params.invoiceKey.toHex();
  let invoice = SmartInvoice.load(id);
  if (!invoice) return;

  invoice.state = "REJECTED";
  invoice.save();
}

export function handleDisputeCreated(event: DisputeCreatedEvent): void {
  let id = event.params.invoiceKey.toHex();
  let invoice = SmartInvoice.load(id);
  if (!invoice) return;
  invoice.state = "DISPUTED";
  invoice.save();
}

export function handleDisputeDismissed(event: DisputeDismissedEvent): void {
  let id = event.params.invoiceKey.toHex();
  let invoice = SmartInvoice.load(id);
  if (!invoice) return;
  invoice.state = "DISPUTE DISMISSED";
  invoice.save();
}

export function handleDisputeResolved(event: DisputeResolvedEvent): void {
  let id = event.params.invoiceKey.toHex();
  let invoice = SmartInvoice.load(id);
  if (!invoice) return;
  invoice.state = "DISPUTE RESOLVED";
  invoice.save();
}

export function handleDisputeSettled(event: DisputeSettledEvent): void {
  let id = event.params.invoiceKey.toHex();
  let invoice = SmartInvoice.load(id);
  if (!invoice) return;
  invoice.state = "DISPUTE SETTLED";
  invoice.save();
}

export function handleCancelationRequested(
  event: CancelationRequestedEvent
): void {
  let id = event.params.invoiceKey.toHex();
  let invoice = SmartInvoice.load(id);
  if (!invoice) return;
  invoice.state = "CANCELATION REQUESTED";
  invoice.save();
}

export function handleCancelationRequestHandled(
  event: CancelationRequestHandledEvent
): void {
  let id = event.params.invoiceKey.toHex();
  let invoice = SmartInvoice.load(id);
  if (!invoice) return;
  invoice.state = event.params.accepted
    ? "CANCELATION_ACCEPTED"
    : "CANCELATION_REJECTED";
  invoice.save();
}

export function handleExpiredInvoiceRefunded(
  event: ExpiredInvoiceRefundedEvent
): void {
  let id = event.params.invoiceKey.toHex();
  let invoice = SmartInvoice.load(id);
  if (!invoice) return;
  invoice.state = "EXPIRED_REFUNDED";
  invoice.save();
}

export function handlePaymentReleased(event: PaymentReleasedEvent): void {
  let id = event.params.invoiceKey.toHex();
  let invoice = SmartInvoice.load(id);
  if (!invoice) return;
  invoice.state = "RELEASED";
  invoice.save();
}
