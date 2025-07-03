import { Address } from "@graphprotocol/graph-ts";
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
  SetPriceFeedCall,
  AdvancedPaymentProcessor,
} from "../generated/AdvancedPaymentProcessor/AdvancedPaymentProcessor";

import {
  SmartInvoice,
  MetaInvoice,
  User,
  PaymentToken,
  Type,
  AdminAction,
  ParentOrder,
} from "../generated/schema";
import { getTokenData } from "./util/token";

export function handleSmartInvoiceCreated(event: InvoiceCreatedEvent): void {
  const invoiceId = event.params.invoice.invoiceId.toString();
  let id = event.params.orderId.toHex();

  const orderId = event.params.invoice.orderId.toHex();
  let orderEntity = ParentOrder.load(orderId);

  if (!orderEntity) {
    orderEntity = new ParentOrder(orderId);
  }

  let invoice = new SmartInvoice(id);

  let adminActionsEntity = new AdminAction(id);

  adminActionsEntity.action = "CREATED";
  adminActionsEntity.time = event.block.timestamp;
  adminActionsEntity.invoiceId = invoiceId;
  adminActionsEntity.type = "SINGLE INVOICE";

  let invoiceType = new Type(id);
  invoiceType.type = "smart-invoice";

  let buyerId = event.params.invoice.buyer.toHex();
  let sellerId = event.params.invoice.seller.toHex();

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
  invoice.parentOrderId = orderId;
  invoice.orderId = event.params.invoice.orderId.toHex();

  invoiceType.save();
  adminActionsEntity.save();
  invoice.save();
  orderEntity.save();
}

export function handleMetaInvoiceCreated(event: MetaInvoiceCreatedEvent): void {
  let id = event.params.metaInvoiceId.toString();
  let meta = new MetaInvoice(id);

  let invoiceType = new Type(id);
  invoiceType.type = "meta-invoice";

  let adminActionsEntity = new AdminAction(id);

  adminActionsEntity.action = "CREATED";
  adminActionsEntity.time = event.block.timestamp;
  adminActionsEntity.invoiceId = id;
  adminActionsEntity.type = "META INVOICE";

  meta.invoiceId = id;
  meta.price = event.params.totalPrice;
  meta.contract = event.address;
  meta.save();

  adminActionsEntity.save();
  invoiceType.save();
}

export function handleInvoicePaid(event: InvoicePaidV2Event): void {
  let id = event.params.orderId.toHex();
  let invoice = SmartInvoice.load(id);
  const buyerId = event.transaction.from.toHex();
  if (!invoice) return;

  let buyer = User.load(buyerId);
  if (!buyer) {
    buyer = new User(buyerId);
    buyer.save();
  }

  invoice.paidAt = event.block.timestamp;
  invoice.buyer = buyerId;
  invoice.amountPaid = event.params.amount;
  invoice.paymentToken = event.params.paymentToken;
  invoice.state = "PAID";
  invoice.cancelAt = invoice.cancelAt!.plus(event.block.timestamp);
  invoice.escrow = event.params.escrowAddress;
  invoice.paymentTxHash = event.block.hash;
  invoice.save();
}

export function handleInvoiceAccepted(event: InvoiceAcceptedEvent): void {
  let id = event.params.orderId.toHex();
  let invoice = SmartInvoice.load(id);
  if (!invoice) return;

  invoice.state = "ACCEPTED";
  invoice.releasedAt = invoice.releasedAt!.plus(event.block.timestamp);
  invoice.save();
}

export function handleInvoiceCanceled(event: InvoiceCanceledEvent): void {
  let id = event.params.orderId.toHex();
  let invoice = SmartInvoice.load(id);
  if (!invoice) return;

  invoice.state = "CANCELED";
  invoice.save();
}

export function handleInvoiceRejected(event: InvoiceRejectedEvent): void {
  let id = event.params.orderId.toHex();
  let invoice = SmartInvoice.load(id);
  if (!invoice) return;

  invoice.state = "REJECTED";
  invoice.save();
}

export function handleDisputeCreated(event: DisputeCreatedEvent): void {
  let id = event.params.orderId.toHex();
  let invoice = SmartInvoice.load(id);
  if (!invoice) return;
  invoice.state = "DISPUTED";
  invoice.save();
}

export function handleDisputeDismissed(event: DisputeDismissedEvent): void {
  let id = event.params.orderId.toHex();
  let invoice = SmartInvoice.load(id);
  if (!invoice) return;
  invoice.state = "DISPUTE DISMISSED";

  let adminActionsEntity = AdminAction.load(id);

  if (!adminActionsEntity) return;

  adminActionsEntity.action = "DISMISSED DISPUTE";

  adminActionsEntity.save();

  invoice.save();
}

export function handleDisputeResolved(event: DisputeResolvedEvent): void {
  let id = event.params.orderId.toHex();
  let invoice = SmartInvoice.load(id);
  if (!invoice) return;
  invoice.state = "DISPUTE RESOLVED";
  invoice.save();
}

export function handleDisputeSettled(event: DisputeSettledEvent): void {
  let id = event.params.orderId.toHex();
  let invoice = SmartInvoice.load(id);
  if (!invoice) return;
  invoice.state = "DISPUTE SETTLED";

  let adminActionsEntity = AdminAction.load(id);
  if (!adminActionsEntity) return;
  adminActionsEntity.action = "SETTLED DISPUTE";

  adminActionsEntity.save();
  invoice.save();
}

export function handleCancelationRequested(
  event: CancelationRequestedEvent
): void {
  let id = event.params.orderId.toHex();
  let invoice = SmartInvoice.load(id);
  if (!invoice) return;
  invoice.state = "CANCELATION REQUESTED";
  invoice.save();
}

export function handleCancelationRequestHandled(
  event: CancelationRequestHandledEvent
): void {
  let id = event.params.orderId.toHex();
  let invoice = SmartInvoice.load(id);
  if (!invoice) return;
  invoice.state = event.params.accepted ? "REFUNDED" : "ACCEPTED";
  invoice.save();
}

export function handleExpiredInvoiceRefunded(
  event: ExpiredInvoiceRefundedEvent
): void {
  let id = event.params.orderId.toHex();
  let invoice = SmartInvoice.load(id);
  if (!invoice) return;
  invoice.state = "REFUNDED";
  invoice.save();
}

export function handlePaymentReleased(event: PaymentReleasedEvent): void {
  let id = event.params.orderId.toHex();
  let invoice = SmartInvoice.load(id);
  if (!invoice) return;
  invoice.state = "RELEASED";
  invoice.releasedAt = event.block.timestamp;
  invoice.releaseHash = event.block.hash;

  let adminActionsEntity = AdminAction.load(id);
  if (!adminActionsEntity) return;
  adminActionsEntity.action = "RELEASED";

  adminActionsEntity.save();
  invoice.save();
}

export function handleAllowedTokens(call: SetPriceFeedCall): void {
  let id = call.inputs.token;

  let tokenData = getTokenData(id);

  let token = new PaymentToken(id.toHex());

  token.decimal = tokenData.decimal;
  token.name = tokenData.name;

  token.save();
}
