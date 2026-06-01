import { Address, BigInt, ethereum } from "@graphprotocol/graph-ts";
import {
  DisputeCreated as DisputeCreatedEvent,
  DisputeDismissed as DisputeDismissedEvent,
  DisputeResolved as DisputeResolvedEvent,
  DisputeSettled as DisputeSettledEvent,
  EscrowCreated as EscrowCreatedEvent,
  InvoiceCanceled as InvoiceCanceledEvent,
  InvoiceCreated as InvoiceCreatedEvent,
  InvoicePaid as InvoicePaidV2Event,
  LockedPaymentRecovered as LockedPaymentRecoveredEvent,
  MetaInvoiceCreated as MetaInvoiceCreatedEvent,
  OracleUpdated as OracleUpdatedEvent,
  PaymentReleased as PaymentReleasedEvent,
  Refunded as RefundedEvent,
  TransferFailed as TransferFailedEvent,
  UpdateReleaseTime as UpdateReleaseTimeEvent,
  WithdrawalRetried as WithdrawalRetriedEvent,
} from "../generated/AdvancedPaymentProcessor/AdvancedPaymentProcessor";
import {
  AdvancedPaymentProcessor,
  InvoiceEvent,
  MetaInvoice,
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
const DISPUTE_DISMISSED = "DISPUTE_DISMISSED";
const DISPUTE_RESOLVED = "DISPUTE_RESOLVED";
const DISPUTE_SETTLED = "DISPUTE_SETTLED";
const REFUNDED = "REFUNDED";
const RELEASED = "RELEASED";
const DISPUTE_CREATED = "DISPUTE_CREATED";
const DISPUTE_DISMISSED_EVENT = "DISPUTE_DISMISSED";
const DISPUTE_RESOLVED_EVENT = "DISPUTE_RESOLVED";
const DISPUTE_SETTLED_EVENT = "DISPUTE_SETTLED";
const ESCROW_CREATED = "ESCROW_CREATED";
const INVOICE_CANCELED = "INVOICE_CANCELED";
const INVOICE_CREATED = "INVOICE_CREATED";
const INVOICE_PAID = "INVOICE_PAID";
const LOCKED_PAYMENT_RECOVERED = "LOCKED_PAYMENT_RECOVERED";
const META_INVOICE_CREATED = "META_INVOICE_CREATED";
const ORACLE_UPDATED = "ORACLE_UPDATED";
const PAYMENT_RELEASED = "PAYMENT_RELEASED";
const TRANSFER_FAILED = "TRANSFER_FAILED";
const UPDATE_RELEASE_TIME = "UPDATE_RELEASE_TIME";
const WITHDRAWAL_RETRIED = "WITHDRAWAL_RETRIED";

function getOrCreateUser(id: string): User {
  let user = User.load(id);
  if (user) return user;

  user = new User(id);
  user.save();

  return user;
}

function eventId(event: ethereum.Event): string {
  return event.transaction.hash.toHex() + "-" + event.logIndex.toString();
}

function saveProcessorEvent(event: ethereum.Event, eventType: string): void {
  const invoiceEvent = new InvoiceEvent(eventId(event));
  invoiceEvent.eventType = eventType;
  invoiceEvent.txHash = event.transaction.hash;
  invoiceEvent.timestamp = event.block.timestamp;
  invoiceEvent.save();
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
  invoiceEvent.advancedInvoice = invoiceId;
  invoiceEvent.save();
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

export function handleAdvancedPaymentProcessorCreated(
  event: InvoiceCreatedEvent
): void {
  const id = event.params.invoiceId.toString();
  const invoiceNonce = event.params.invoice.invoiceNonce;

  const invoice = new AdvancedPaymentProcessor(id);

  const buyerId = event.params.invoice.buyer.toHex();
  const sellerId = event.params.invoice.seller.toHex();

  getOrCreateUser(buyerId);
  getOrCreateUser(sellerId);

  invoice.buyer = buyerId;
  invoice.seller = sellerId;
  invoice.state = CREATED;
  invoice.price = event.params.invoice.price;
  invoice.contract = event.address;
  invoice.invoiceNonce = invoiceNonce;
  invoice.lastActionTime = event.block.timestamp;
  invoice.amountReleased = ZERO;
  invoice.amountRefunded = ZERO;
  invoice.sellerAmountReceivedAfterDispute = ZERO;
  invoice.buyerAmountReceivedAfterDispute = ZERO;

  const metaInvoiceId = event.params.invoice.metaInvoiceId;
  if (metaInvoiceId.gt(ZERO)) {
    invoice.metaInvoice = metaInvoiceId.toString();
  }

  invoice.save();
  saveInvoiceEvent(event, id, INVOICE_CREATED);
}

export function handleMetaInvoiceCreated(event: MetaInvoiceCreatedEvent): void {
  const id = event.params.metaInvoiceId.toString();
  const metaInvoice = new MetaInvoice(id);

  const buyerId = event.transaction.from.toHex();
  getOrCreateUser(buyerId);

  metaInvoice.invoiceNonce = event.params.metaInvoiceId;
  metaInvoice.buyer = buyerId;
  metaInvoice.price = event.params.totalPrice;
  metaInvoice.contract = event.address;

  metaInvoice.save();
  saveProcessorEvent(event, META_INVOICE_CREATED);
}

export function handleInvoicePaid(event: InvoicePaidV2Event): void {
  const id = event.params.invoiceId.toString();
  const invoice = AdvancedPaymentProcessor.load(id);
  if (!invoice) return;

  const amountPaid = event.params.amount;
  const buyerId = event.transaction.from.toHex();

  getOrCreateUser(buyerId);

  const token = getOrCreatePaymentToken(event.params.paymentToken);

  invoice.buyer = buyerId;
  invoice.amountPaid = amountPaid;
  invoice.balance = amountPaid;
  invoice.state = PAID;
  invoice.escrow = event.params.escrowAddress;
  invoice.paymentToken = token.id;
  invoice.fee = getFee(amountPaid);
  invoice.lastActionTime = event.block.timestamp;

  invoice.save();
  saveInvoiceEvent(event, id, INVOICE_PAID);
}

export function handleInvoiceCanceled(event: InvoiceCanceledEvent): void {
  const id = event.params.invoiceId.toString();
  const invoice = AdvancedPaymentProcessor.load(id);
  if (!invoice) return;

  invoice.state = CANCELED;
  invoice.lastActionTime = event.block.timestamp;

  invoice.save();
  saveInvoiceEvent(event, id, INVOICE_CANCELED);
}

export function handleDisputeCreated(event: DisputeCreatedEvent): void {
  const id = event.params.invoiceId.toString();
  const invoice = AdvancedPaymentProcessor.load(id);
  if (!invoice) return;

  invoice.state = DISPUTED;
  invoice.lastActionTime = event.block.timestamp;

  invoice.save();
  saveInvoiceEvent(event, id, DISPUTE_CREATED);
}

export function handleDisputeDismissed(event: DisputeDismissedEvent): void {
  const id = event.params.invoiceId.toString();
  const invoice = AdvancedPaymentProcessor.load(id);
  if (!invoice) return;

  invoice.state = DISPUTE_DISMISSED;
  invoice.lastActionTime = event.block.timestamp;

  invoice.save();
  saveInvoiceEvent(event, id, DISPUTE_DISMISSED_EVENT);
}

export function handleDisputeResolved(event: DisputeResolvedEvent): void {
  const id = event.params.invoiceId.toString();
  const invoice = AdvancedPaymentProcessor.load(id);
  if (!invoice) return;

  invoice.state = DISPUTE_RESOLVED;
  invoice.lastActionTime = event.block.timestamp;

  invoice.save();
  saveInvoiceEvent(event, id, DISPUTE_RESOLVED_EVENT);
}

export function handleDisputeSettled(event: DisputeSettledEvent): void {
  const id = event.params.invoiceId.toString();
  const invoice = AdvancedPaymentProcessor.load(id);
  if (!invoice) return;

  invoice.state = DISPUTE_SETTLED;
  invoice.lastActionTime = event.block.timestamp;
  invoice.amountReleased = event.params.sellerAmount;
  invoice.amountRefunded = event.params.buyerAmount;
  invoice.sellerAmountReceivedAfterDispute = event.params.sellerAmount;
  invoice.buyerAmountReceivedAfterDispute = event.params.buyerAmount;

  invoice.save();
  saveInvoiceEvent(event, id, DISPUTE_SETTLED_EVENT);
}

export function handleRefunded(event: RefundedEvent): void {
  const id = event.params.invoiceId.toString();
  const invoice = AdvancedPaymentProcessor.load(id);
  if (!invoice) return;

  if (invoice.balance) {
    invoice.balance = invoice.balance!.minus(event.params.amount);
  }

  const state = REFUNDED;
  const previousRefunded = invoice.amountRefunded ? invoice.amountRefunded! : ZERO;

  invoice.state = state;
  invoice.lastActionTime = event.block.timestamp;
  invoice.amountRefunded = previousRefunded.plus(event.params.amount);

  invoice.save();
  saveInvoiceEvent(event, id, REFUNDED);
}

export function handlePaymentReleased(event: PaymentReleasedEvent): void {
  const id = event.params.invoiceId.toString();
  const invoice = AdvancedPaymentProcessor.load(id);
  if (!invoice) return;

  invoice.state = RELEASED;
  invoice.lastActionTime = event.block.timestamp;
  invoice.balance = ZERO;
  invoice.amountReleased = event.params.sellerAmount;

  invoice.save();
  saveInvoiceEvent(event, id, PAYMENT_RELEASED);
}

export function handleUpdateReleaseTime(event: UpdateReleaseTimeEvent): void {
  const id = event.params.invoiceId.toString();
  const invoice = AdvancedPaymentProcessor.load(id);
  if (!invoice) return;

  invoice.lastActionTime = event.block.timestamp;

  invoice.save();
  saveInvoiceEvent(event, id, UPDATE_RELEASE_TIME);
}

export function handleEscrowCreated(event: EscrowCreatedEvent): void {
  const id = event.params.invoiceId.toString();
  const invoice = AdvancedPaymentProcessor.load(id);
  if (!invoice) return;

  invoice.escrow = event.params.escrow;
  invoice.lastActionTime = event.block.timestamp;
  invoice.save();
  saveInvoiceEvent(event, id, ESCROW_CREATED);
}

export function handleLockedPaymentRecovered(
  event: LockedPaymentRecoveredEvent
): void {
  const id = event.params.invoiceId.toString();
  const invoice = AdvancedPaymentProcessor.load(id);
  if (!invoice) return;

  invoice.lastActionTime = event.block.timestamp;
  invoice.save();
  saveInvoiceEvent(event, id, LOCKED_PAYMENT_RECOVERED);
}

export function handleOracleUpdated(event: OracleUpdatedEvent): void {
  saveProcessorEvent(event, ORACLE_UPDATED);
}

export function handleTransferFailed(event: TransferFailedEvent): void {
  const id = event.params.invoiceId.toString();
  const invoice = AdvancedPaymentProcessor.load(id);
  if (!invoice) return;

  invoice.lastActionTime = event.block.timestamp;
  invoice.save();
  saveInvoiceEvent(event, id, TRANSFER_FAILED);
}

export function handleWithdrawalRetried(event: WithdrawalRetriedEvent): void {
  const id = event.params.invoiceId.toString();
  const invoice = AdvancedPaymentProcessor.load(id);
  if (!invoice) return;

  invoice.lastActionTime = event.block.timestamp;
  invoice.save();
  saveInvoiceEvent(event, id, WITHDRAWAL_RETRIED);
}
