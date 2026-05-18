import { Address, BigInt } from "@graphprotocol/graph-ts";
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
  UpdateReleaseTime as UpdateReleaseTimeEvent,
} from "../generated/AdvancedPaymentProcessor/AdvancedPaymentProcessor";
import {
  AdminAction,
  MetaInvoice,
  AdvancedPaymentProcessor,
  InvoiceType,
  PaymentToken,
  User,
} from "../generated/schema";
import { getFee } from "./util/storage";
import { getTokenData } from "./util/token";

const ZERO = BigInt.fromI32(0);
const CREATED = "CREATED";
const PAID = "PAID";
const CANCELED = "CANCELED";
const DISPUTED = "DISPUTED";
const DISPUTE_DISMISSED = "DISPUTE DISMISSED";
const DISPUTE_RESOLVED = "DISPUTE RESOLVED";
const DISPUTE_SETTLED = "DISPUTE SETTLED";
const REFUNDED = "REFUNDED";
const RELEASED = "RELEASED";

function getOrCreateUser(id: string): User {
  let user = User.load(id);
  if (user) return user;

  user = new User(id);
  user.save();

  return user;
}

function getOrCreatePaymentToken(tokenAddress: Address): PaymentToken {
  const id = tokenAddress.toHex();
  let token = PaymentToken.load(id);
  if (token) return token;

  const data = getTokenData(tokenAddress);
  token = new PaymentToken(id);
  token.name = data.name;
  token.decimal = data.decimal;
  token.save();

  return token;
}

function addHistory(
  entity: AdvancedPaymentProcessor,
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

function getAmountValue(amount: string | null): BigInt {
  return amount ? BigInt.fromString(amount) : ZERO;
}

export function handleAdvancedPaymentProcessorCreated(
  event: InvoiceCreatedEvent
): void {
  const id = event.params.invoiceId.toString();
  const invoiceNonce = event.params.invoice.invoiceNonce.toString();

  const invoice = new AdvancedPaymentProcessor(id);
  const adminAction = new AdminAction(id);
  const invoiceType = new InvoiceType(id);

  const buyerId = event.params.invoice.buyer.toHex();
  const sellerId = event.params.invoice.seller.toHex();

  getOrCreateUser(buyerId);
  getOrCreateUser(sellerId);

  adminAction.action = CREATED;
  adminAction.time = event.block.timestamp;
  adminAction.invoiceNonce = invoiceNonce;
  adminAction.category = "INVOICE";
  adminAction.txHash = event.transaction.hash.toHex();

  invoiceType.type = "AdvancedPaymentProcessor";

  invoice.buyer = buyerId;
  invoice.seller = sellerId;
  invoice.createdAt = event.block.timestamp;
  invoice.state = CREATED;
  invoice.price = event.params.invoice.price;
  invoice.contract = event.address;
  invoice.invoiceNonce = invoiceNonce;
  invoice.creationTxHash = event.transaction.hash.toHex();
  invoice.lastActionTime = event.block.timestamp;
  invoice.amountReleased = ZERO.toString();
  invoice.amountRefunded = ZERO.toString();
  invoice.sellerAmountReceivedAfterDispute = ZERO.toString();
  invoice.buyerAmountReceivedAfterDispute = ZERO.toString();
  addHistory(invoice, CREATED, event.block.timestamp);

  invoiceType.save();
  adminAction.save();
  invoice.save();
}

export function handleMetaInvoiceCreated(event: MetaInvoiceCreatedEvent): void {
  const id = event.params.metaInvoiceId.toString();
  const metaInvoice = new MetaInvoice(id);
  const invoiceType = new InvoiceType(id);
  const adminAction = new AdminAction(id);

  invoiceType.type = "meta-invoice";

  adminAction.action = CREATED;
  adminAction.time = event.block.timestamp;
  adminAction.invoiceNonce = id;
  adminAction.category = "META INVOICE";
  adminAction.txHash = event.transaction.hash.toHex();

  metaInvoice.invoiceId = id;
  metaInvoice.price = event.params.totalPrice;
  metaInvoice.contract = event.address;

  metaInvoice.save();
  invoiceType.save();
  adminAction.save();
}

export function handleInvoicePaid(event: InvoicePaidV2Event): void {
  const id = event.params.invoiceId.toString();
  const invoice = AdvancedPaymentProcessor.load(id);
  if (!invoice) return;

  const amountPaid = event.params.amount;
  const buyerId = event.transaction.from.toHex();

  getOrCreateUser(buyerId);

  const paymentToken = getOrCreatePaymentToken(event.params.paymentToken);

  invoice.paidAt = event.block.timestamp;
  invoice.buyer = buyerId;
  invoice.amountPaid = amountPaid;
  invoice.balance = amountPaid;
  invoice.paymentToken = paymentToken.id;
  invoice.state = PAID;
  invoice.escrow = event.params.escrowAddress;
  invoice.paymentTxHash = event.transaction.hash;
  invoice.releasedAt = event.params.releaseAt;
  invoice.fee = getFee(amountPaid);
  invoice.lastActionTime = event.block.timestamp;
  addHistory(invoice, PAID, event.block.timestamp);

  invoice.save();

  const adminAction = AdminAction.load(id);
  if (adminAction) {
    adminAction.balance = invoice.amountPaid;
    adminAction.currency = invoice.paymentToken;
    adminAction.save();
  }
}

export function handleInvoiceCanceled(event: InvoiceCanceledEvent): void {
  const id = event.params.invoiceId.toString();
  const invoice = AdvancedPaymentProcessor.load(id);
  if (!invoice) return;

  invoice.state = CANCELED;
  invoice.lastActionTime = event.block.timestamp;
  addHistory(invoice, CANCELED, event.block.timestamp);

  const adminAction = AdminAction.load(id);
  if (adminAction) {
    adminAction.action = CANCELED;
    adminAction.txHash = event.transaction.hash.toHex();
    adminAction.save();
  }

  invoice.save();
}

export function handleDisputeCreated(event: DisputeCreatedEvent): void {
  const id = event.params.invoiceId.toString();
  const invoice = AdvancedPaymentProcessor.load(id);
  if (!invoice) return;

  invoice.state = DISPUTED;
  invoice.lastActionTime = event.block.timestamp;
  addHistory(invoice, DISPUTED, event.block.timestamp);

  const adminAction = AdminAction.load(id);
  if (adminAction) {
    adminAction.action = DISPUTED;
    adminAction.txHash = event.transaction.hash.toHex();
    adminAction.save();
  }

  invoice.save();
}

export function handleDisputeDismissed(event: DisputeDismissedEvent): void {
  const id = event.params.invoiceId.toString();
  const invoice = AdvancedPaymentProcessor.load(id);
  if (!invoice) return;

  invoice.state = DISPUTE_DISMISSED;
  invoice.lastActionTime = event.block.timestamp;
  addHistory(invoice, DISPUTE_DISMISSED, event.block.timestamp);

  const adminAction = AdminAction.load(id);
  if (adminAction) {
    adminAction.action = DISPUTE_DISMISSED;
    adminAction.txHash = event.transaction.hash.toHex();
    adminAction.save();
  }

  invoice.save();
}

export function handleDisputeResolved(event: DisputeResolvedEvent): void {
  const id = event.params.invoiceId.toString();
  const invoice = AdvancedPaymentProcessor.load(id);
  if (!invoice) return;

  invoice.state = DISPUTE_RESOLVED;
  invoice.lastActionTime = event.block.timestamp;
  addHistory(invoice, DISPUTE_RESOLVED, event.block.timestamp);

  const adminAction = AdminAction.load(id);
  if (adminAction) {
    adminAction.action = DISPUTE_RESOLVED;
    adminAction.save();
  }

  invoice.save();
}

export function handleDisputeSettled(event: DisputeSettledEvent): void {
  const id = event.params.invoiceId.toString();
  const invoice = AdvancedPaymentProcessor.load(id);
  if (!invoice) return;

  invoice.state = DISPUTE_SETTLED;
  invoice.commissionTxHash = event.transaction.hash;
  invoice.disputeSettledTxHash = event.transaction.hash;
  invoice.lastActionTime = event.block.timestamp;
  invoice.amountReleased = event.params.sellerAmount.toString();
  invoice.amountRefunded = event.params.buyerAmount.toString();
  invoice.sellerAmountReceivedAfterDispute =
    event.params.sellerAmount.toString();
  invoice.buyerAmountReceivedAfterDispute = event.params.buyerAmount.toString();
  addHistory(invoice, DISPUTE_SETTLED, event.block.timestamp);

  const adminAction = AdminAction.load(id);
  if (adminAction) {
    adminAction.action = DISPUTE_SETTLED;
    adminAction.save();
  }

  invoice.save();
}

export function handleRefunded(event: RefundedEvent): void {
  const id = event.params.invoiceId.toString();
  const invoice = AdvancedPaymentProcessor.load(id);
  if (!invoice) return;

  if (invoice.balance) {
    invoice.balance = invoice.balance!.minus(event.params.amount);
  }

  const state = REFUNDED;
  const refunded = getAmountValue(invoice.amountRefunded).plus(event.params.amount);

  invoice.state = state;
  invoice.refundTxHash = event.transaction.hash;
  invoice.lastActionTime = event.block.timestamp;
  invoice.amountRefunded = refunded.toString();
  addHistory(invoice, state, event.block.timestamp);

  const adminAction = AdminAction.load(id);
  if (adminAction) {
    adminAction.action = state;
    adminAction.balance = invoice.balance;
    adminAction.save();
  }

  invoice.save();
}

export function handlePaymentReleased(event: PaymentReleasedEvent): void {
  const id = event.params.invoiceId.toString();
  const invoice = AdvancedPaymentProcessor.load(id);
  if (!invoice) return;

  invoice.state = RELEASED;
  invoice.releasedAt = event.block.timestamp;
  invoice.releaseHash = event.transaction.hash;
  invoice.commissionTxHash = event.transaction.hash;
  invoice.lastActionTime = event.block.timestamp;
  invoice.balance = ZERO;
  invoice.amountReleased = event.params.sellerAmount.toString();
  addHistory(invoice, RELEASED, event.block.timestamp);

  const adminAction = AdminAction.load(id);
  if (adminAction) {
    adminAction.action = RELEASED;
    adminAction.balance = ZERO;
    adminAction.save();
  }

  invoice.save();
}

export function handleUpdateReleaseTime(event: UpdateReleaseTimeEvent): void {
  const id = event.params.invoiceId.toString();
  const invoice = AdvancedPaymentProcessor.load(id);
  if (!invoice) return;

  invoice.lastActionTime = event.block.timestamp;
  invoice.releasedAt = event.block.timestamp.plus(event.params.newHoldPeriod);

  invoice.save();
}
