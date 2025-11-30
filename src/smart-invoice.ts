import { BigInt } from "@graphprotocol/graph-ts";
import {
  DisputeCreated as DisputeCreatedEvent,
  DisputeDismissed as DisputeDismissedEvent,
  DisputeResolved as DisputeResolvedEvent,
  DisputeSettled as DisputeSettledEvent,
  InvoiceCanceled as InvoiceCanceledEvent,
  InvoiceCreated as InvoiceCreatedEvent,
  InvoicePaid as InvoicePaidV2Event,
  MetaInvoiceCreated as MetaInvoiceCreatedEvent,
  PaymentReleased as PaymentReleasedEvent,
  Refunded as RefundedEvent,
  SetPriceFeedCall,
  UpdateReleaseTime as UpdateReleaseTimeEvent,
} from "../generated/AdvancedPaymentProcessor/AdvancedPaymentProcessor";
import {
  AdminAction,
  MetaInvoice,
  PaymentToken,
  SmartInvoice,
  Type,
  User,
} from "../generated/schema";
import { getTokenData } from "./util/token";
import { getDefaultHoldPeriod, getFee } from "./util/storage";

const ZERO = BigInt.fromI32(0);

function getOrCreateUser(id: string): User {
  let user = User.load(id);
  if (user) return user;

  user = new User(id);
  user.save();

  return user;
}

function loadAdminAction(id: string): AdminAction | null {
  return AdminAction.load(id);
}

export function handleSmartInvoiceCreated(event: InvoiceCreatedEvent): void {
  const invoiceId = event.params.invoice.invoiceId.toString();
  const id = event.params.orderId.toString();

  const invoice = new SmartInvoice(id);
  const adminAction = new AdminAction(id);
  const invoiceType = new Type(id);

  const buyerId = event.params.invoice.buyer.toHex();
  const sellerId = event.params.invoice.seller.toHex();

  getOrCreateUser(sellerId);

  adminAction.action = "CREATED";
  adminAction.time = event.block.timestamp;
  adminAction.invoiceId = invoiceId;
  adminAction.type = "INVOICE";
  adminAction.txHash = event.transaction.hash.toHex();

  invoiceType.type = "smart-invoice";

  invoice.buyer = buyerId;
  invoice.seller = sellerId;
  invoice.createdAt = event.block.timestamp;
  invoice.state = "CREATED";
  invoice.price = event.params.invoice.price;
  invoice.contract = event.address;
  invoice.invoiceId = invoiceId;
  invoice.creationTxHash = event.transaction.hash.toHex();
  invoice.lastActionTime = event.block.timestamp;

  invoiceType.save();
  adminAction.save();
  invoice.save();
}

export function handleMetaInvoiceCreated(event: MetaInvoiceCreatedEvent): void {
  const id = event.params.metaInvoiceId.toHex();
  const metaInvoice = new MetaInvoice(id);
  const invoiceType = new Type(id);
  const adminAction = new AdminAction(id);

  invoiceType.type = "meta-invoice";

  adminAction.action = "CREATED";
  adminAction.time = event.block.timestamp;
  adminAction.invoiceId = id;
  adminAction.type = "META INVOICE";
  adminAction.txHash = event.transaction.hash.toHex();

  metaInvoice.invoiceId = id;
  metaInvoice.price = event.params.totalPrice;
  metaInvoice.contract = event.address;

  metaInvoice.save();
  invoiceType.save();
  adminAction.save();
}

export function handleInvoicePaid(event: InvoicePaidV2Event): void {
  const id = event.params.orderId.toString();
  const invoice = SmartInvoice.load(id);
  if (!invoice) return;

  const amountPaid = event.params.amount;
  const buyerId = event.transaction.from.toHex();

  getOrCreateUser(buyerId);

  invoice.paidAt = event.block.timestamp;
  invoice.buyer = buyerId;
  invoice.amountPaid = amountPaid;
  invoice.balance = amountPaid;
  invoice.paymentToken = event.params.paymentToken.toHex();
  invoice.state = "PAID";
  invoice.escrow = event.params.escrowAddress;
  invoice.paymentTxHash = event.transaction.hash;
  invoice.releasedAt = event.block.timestamp.plus(
    getDefaultHoldPeriod().defaultHoldPeriod
  );
  invoice.fee = getFee(amountPaid).fee;
  invoice.lastActionTime = event.block.timestamp;

  invoice.save();

  const adminAction = loadAdminAction(id);
  if (adminAction) {
    adminAction.balance = invoice.amountPaid;
    adminAction.currency = invoice.paymentToken;
    adminAction.save();
  }
}

export function handleInvoiceCanceled(event: InvoiceCanceledEvent): void {
  const id = event.params.orderId.toString();
  const invoice = SmartInvoice.load(id);
  if (!invoice) return;

  invoice.state = "CANCELED";
  invoice.lastActionTime = event.block.timestamp;

  const adminAction = loadAdminAction(id);
  if (adminAction) {
    adminAction.action = "CANCELED";
    adminAction.txHash = event.transaction.hash.toHex();
    adminAction.save();
  }

  invoice.save();
}

export function handleDisputeCreated(event: DisputeCreatedEvent): void {
  const id = event.params.orderId.toString();
  const invoice = SmartInvoice.load(id);
  if (!invoice) return;

  invoice.state = "DISPUTED";
  invoice.lastActionTime = event.block.timestamp;

  const adminAction = loadAdminAction(id);
  if (adminAction) {
    adminAction.action = "DISPUTED";
    adminAction.txHash = event.transaction.hash.toHex();
    adminAction.save();
  }

  invoice.save();
}

export function handleDisputeDismissed(event: DisputeDismissedEvent): void {
  const id = event.params.orderId.toString();
  const invoice = SmartInvoice.load(id);
  if (!invoice) return;

  invoice.state = "DISPUTE DISMISSED";
  invoice.lastActionTime = event.block.timestamp;

  const adminAction = loadAdminAction(id);
  if (adminAction) {
    adminAction.action = "DISPUTE DISMISSED";
    adminAction.txHash = event.transaction.hash.toHex();
    adminAction.save();
  }

  invoice.save();
}

export function handleDisputeResolved(event: DisputeResolvedEvent): void {
  const id = event.params.orderId.toString();
  const invoice = SmartInvoice.load(id);
  if (!invoice) return;

  const state = "DISPUTE RESOLVED";

  invoice.state = state;
  invoice.lastActionTime = event.block.timestamp;

  const adminAction = loadAdminAction(id);
  if (adminAction) {
    adminAction.action = state;
    adminAction.save();
  }

  invoice.save();
}

export function handleDisputeSettled(event: DisputeSettledEvent): void {
  const id = event.params.orderId.toString();
  const invoice = SmartInvoice.load(id);
  if (!invoice) return;

  const state = "DISPUTE SETTLED";

  invoice.state = state;
  invoice.commisionTxHash = event.transaction.hash;
  invoice.lastActionTime = event.block.timestamp;

  const adminAction = loadAdminAction(id);
  if (adminAction) {
    adminAction.action = state;
    adminAction.save();
  }

  invoice.save();
}

export function handleRefunded(event: RefundedEvent): void {
  const id = event.params.orderId.toString();
  const invoice = SmartInvoice.load(id);
  if (!invoice) return;

  if (invoice.balance) {
    invoice.balance = invoice.balance!.minus(event.params.amount);
  }

  const balance = invoice.balance ? invoice.balance! : ZERO;

  const adminAction = loadAdminAction(id);
  if (adminAction) {
    adminAction.action = balance.equals(ZERO) ? "REFUNDED" : "PARTIAL REFUND";
    adminAction.balance = invoice.balance;
    adminAction.save();
  }

  invoice.refundTxHash = event.transaction.hash;
  invoice.lastActionTime = event.block.timestamp;

  invoice.save();
}

export function handlePaymentReleased(event: PaymentReleasedEvent): void {
  const id = event.params.orderId.toString();
  const invoice = SmartInvoice.load(id);
  if (!invoice) return;

  invoice.state = "RELEASED";
  invoice.releasedAt = event.block.timestamp;
  invoice.releaseHash = event.transaction.hash;
  invoice.commisionTxHash = event.transaction.hash;
  invoice.lastActionTime = event.block.timestamp;
  invoice.balance = ZERO;

  const adminAction = loadAdminAction(id);
  if (adminAction) {
    adminAction.action = "RELEASED";
    adminAction.balance = ZERO;
    adminAction.save();
  }

  invoice.save();
}

export function handleUpdateReleaseTime(event: UpdateReleaseTimeEvent): void {
  const id = event.params.orderId.toString();
  const invoice = SmartInvoice.load(id);
  if (!invoice) return;

  invoice.lastActionTime = event.block.timestamp;
  invoice.releasedAt = event.block.timestamp.plus(event.params.newHoldPeriod);

  invoice.save();
}

export function handleAllowedTokens(call: SetPriceFeedCall): void {
  const id = call.inputs.token;
  const tokenData = getTokenData(id);
  const token = new PaymentToken(id.toHex());

  token.decimal = tokenData.decimal;
  token.name = tokenData.name;

  token.save();
}
