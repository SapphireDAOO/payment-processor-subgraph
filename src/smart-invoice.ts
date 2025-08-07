import { BigInt } from "@graphprotocol/graph-ts";
import {
  InvoiceCreated as InvoiceCreatedEvent,
  MetaInvoiceCreated as MetaInvoiceCreatedEvent,
  DisputeCreated as DisputeCreatedEvent,
  DisputeDismissed as DisputeDismissedEvent,
  DisputeResolved as DisputeResolvedEvent,
  DisputeSettled as DisputeSettledEvent,
  PaymentReleased as PaymentReleasedEvent,
  InvoicePaid as InvoicePaidV2Event,
  InvoiceCanceled as InvoiceCanceledEvent,
  SetPriceFeedCall,
  Refunded as RefundedEvent,
} from "../generated/AdvancedPaymentProcessor/AdvancedPaymentProcessor";

import {
  SmartInvoice,
  MetaInvoice,
  User,
  PaymentToken,
  Type,
  AdminAction,
} from "../generated/schema";
import { getTokenData } from "./util/token";

export function handleSmartInvoiceCreated(event: InvoiceCreatedEvent): void {
  const invoiceId = event.params.invoice.invoiceId.toString();
  let id = event.params.orderId.toHex();

  let invoice = new SmartInvoice(id);

  let adminActionsEntity = new AdminAction(id);

  adminActionsEntity.action = "CREATED";
  adminActionsEntity.time = event.block.timestamp;
  adminActionsEntity.invoiceId = invoiceId;
  adminActionsEntity.type = "INVOICE";
  adminActionsEntity.txHash = event.transaction.hash.toHex();

  let invoiceType = new Type(id);
  invoiceType.type = "smart-invoice";

  let buyerId = event.params.invoice.buyer.toHex();
  let sellerId = event.params.invoice.seller.toHex();

  let seller = User.load(sellerId);
  if (!seller) {
    seller = new User(sellerId);
    seller.save();
  }

  invoice.buyer = buyerId;
  invoice.seller = sellerId;
  invoice.createdAt = event.block.timestamp;
  invoice.state = "CREATED";
  invoice.price = event.params.invoice.price;
  invoice.contract = event.address;
  invoice.orderId = event.params.invoice.invoiceId.toHex();
  invoice.invoiceId = id;
  invoice.creationTxHash = event.transaction.hash.toHex();

  invoiceType.save();
  adminActionsEntity.save();
  invoice.save();
}

export function handleMetaInvoiceCreated(event: MetaInvoiceCreatedEvent): void {
  let id = event.params.metaInvoiceId.toHex();
  let meta = new MetaInvoice(id);

  let invoiceType = new Type(id);
  invoiceType.type = "meta-invoice";

  let adminActionsEntity = new AdminAction(id);

  adminActionsEntity.action = "CREATED";
  adminActionsEntity.time = event.block.timestamp;
  adminActionsEntity.invoiceId = id;
  adminActionsEntity.type = "META INVOICE";
  adminActionsEntity.txHash = event.transaction.hash.toHex();

  meta.invoiceId = id;
  meta.price = event.params.totalPrice;
  meta.contract = event.address;
  meta.save();

  invoiceType.save();
  adminActionsEntity.save();
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
  invoice.balance = event.params.amount;
  invoice.paymentToken = event.params.paymentToken.toHex();
  invoice.state = "PAID";
  invoice.escrow = event.params.escrowAddress;
  invoice.paymentTxHash = event.block.hash;
  invoice.save();

  let adminActionsEntity = AdminAction.load(id);
  if (!adminActionsEntity) return;
  adminActionsEntity.balance = invoice.amountPaid;
  adminActionsEntity.currency = invoice.paymentToken;

  adminActionsEntity.save();
}

export function handleInvoiceCanceled(event: InvoiceCanceledEvent): void {
  let id = event.params.orderId.toHex();
  let invoice = SmartInvoice.load(id);
  if (!invoice) return;

  invoice.state = "CANCELED";

  let adminActionsEntity = AdminAction.load(id);
  if (!adminActionsEntity) return;
  adminActionsEntity.action = "CANCELED";
  adminActionsEntity.txHash = event.transaction.hash.toHex();

  invoice.save();
  adminActionsEntity.save();
}

export function handleDisputeCreated(event: DisputeCreatedEvent): void {
  let id = event.params.orderId.toHex();
  let invoice = SmartInvoice.load(id);
  if (!invoice) return;
  invoice.state = "DISPUTED";

  let adminActionsEntity = AdminAction.load(id);
  if (!adminActionsEntity) return;
  adminActionsEntity.action = "DISPUTED";
  adminActionsEntity.txHash = event.transaction.hash.toHex();

  invoice.save();
  adminActionsEntity.save();
}

export function handleDisputeDismissed(event: DisputeDismissedEvent): void {
  let id = event.params.orderId.toHex();
  let invoice = SmartInvoice.load(id);
  if (!invoice) return;
  invoice.state = "DISPUTE DISMISSED";

  let adminActionsEntity = AdminAction.load(id);
  if (!adminActionsEntity) return;

  adminActionsEntity.action = "DISPUTE DISMISSED";
  adminActionsEntity.txHash = event.transaction.hash.toHex();

  adminActionsEntity.save();

  invoice.save();
}

export function handleDisputeResolved(event: DisputeResolvedEvent): void {
  let id = event.params.orderId.toHex();
  let invoice = SmartInvoice.load(id);

  const state = "DISPUTE RESOLVED";

  if (!invoice) return;
  invoice.state = state;

  let adminActionsEntity = AdminAction.load(id);
  if (!adminActionsEntity) return;
  adminActionsEntity.action = state;

  invoice.save();
  adminActionsEntity.save();
}

export function handleDisputeSettled(event: DisputeSettledEvent): void {
  let id = event.params.orderId.toHex();
  let invoice = SmartInvoice.load(id);

  const state = "DISPUTE SETTLED";

  if (!invoice) return;
  invoice.state = state;

  let adminActionsEntity = AdminAction.load(id);
  if (!adminActionsEntity) return;
  adminActionsEntity.action = state;

  adminActionsEntity.save();
  invoice.save();
}

export function handleRefunded(event: RefundedEvent): void {
  let id = event.params.orderId.toHex();
  let invoice = SmartInvoice.load(id);
  if (!invoice) return;

  if (invoice.balance) {
    invoice.balance = invoice.balance!.minus(event.params.amount);
  }

  let adminActionsEntity = AdminAction.load(id);
  if (!adminActionsEntity) return;

  if (invoice.balance!.equals(new BigInt(0))) {
    adminActionsEntity.action = "REFUNDED";
  } else {
    adminActionsEntity.action = "PARTIAL REFUND";
  }

  adminActionsEntity.balance = invoice.balance;

  invoice.save();
  adminActionsEntity.save();
}

export function handlePaymentReleased(event: PaymentReleasedEvent): void {
  let id = event.params.orderId.toHex();
  let invoice = SmartInvoice.load(id);
  if (!invoice) return;
  invoice.state = "RELEASED";
  invoice.releasedAt = event.block.timestamp;
  invoice.releaseHash = event.transaction.hash;
  invoice.balance = new BigInt(0);

  let adminActionsEntity = AdminAction.load(id);
  if (!adminActionsEntity) return;
  adminActionsEntity.action = "RELEASED";
  adminActionsEntity.balance = new BigInt(0);

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
