import { Address, ethereum } from "@graphprotocol/graph-ts";
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
} from "../generated/AdvancedPaymentProcessor/AdvancedPaymentProcessor";
import {
  AdvancedPaymentProcessor,
  InvoiceEvent,
  MetaInvoice,
} from "../generated/schema";
import { getFee } from "./payment-processor-storage";
import {
  getOrCreatePaymentToken,
  recordEscrowDelta,
  recordFee,
  recordGas,
  recordInvoiceActivity,
  recordPaymentVolume,
} from "./util/metrics";
import { trackUser } from "./util/user";
import {
  ADVANCED,
  CANCELED,
  CREATED,
  CREATOR,
  DISPUTE_CREATED,
  DISPUTE_DISMISSED,
  DISPUTE_DISMISSED_EVENT,
  DISPUTE_RESOLVED,
  DISPUTE_RESOLVED_EVENT,
  DISPUTE_SETTLED,
  DISPUTE_SETTLED_EVENT,
  DISPUTED,
  ESCROW_CREATED,
  INVOICE_CANCELED,
  INVOICE_CREATED,
  INVOICE_PAID,
  LOCKED_PAYMENT_RECOVERED,
  META_INVOICE_CREATED,
  ORACLE_UPDATED,
  PAID,
  PAYER,
  PAYMENT_RELEASED,
  REFUNDED,
  RELEASED,
  TRANSFER_FAILED,
  UPDATE_RELEASE_TIME,
  ZERO,
} from "./util/constants";

function eventId(event: ethereum.Event): string {
  return event.transaction.hash.toHex() + "-" + event.logIndex.toString();
}

function saveProcessorEvent(event: ethereum.Event, eventType: string): void {
  const invoiceEvent = new InvoiceEvent(eventId(event));
  invoiceEvent.eventType = eventType;
  invoiceEvent.txHash = event.transaction.hash;
  invoiceEvent.timestamp = event.block.timestamp;
  invoiceEvent.save();

  recordGas(event);
}

function saveInvoiceEvent(
  event: ethereum.Event,
  invoiceId: string,
  eventType: string,
  trackGas: boolean,
): void {
  const invoiceEvent = new InvoiceEvent(eventId(event));
  invoiceEvent.eventType = eventType;
  invoiceEvent.txHash = event.transaction.hash;
  invoiceEvent.timestamp = event.block.timestamp;
  invoiceEvent.advancedInvoice = invoiceId;
  invoiceEvent.save();

  recordInvoiceActivity(ADVANCED);
  if (trackGas) {
    recordGas(event);
  }
}

function invoiceToken(invoice: AdvancedPaymentProcessor): Address {
  return invoice.paymentToken === null
    ? Address.zero()
    : Address.fromString(invoice.paymentToken!);
}

export function handleAdvancedPaymentProcessorCreated(
  event: InvoiceCreatedEvent,
): void {
  const id = event.params.invoiceId.toString();
  const invoiceNonce = event.params.invoice.invoiceNonce;

  const invoice = new AdvancedPaymentProcessor(id);

  //
  const sellerId = event.params.invoice.seller.toHex();

  trackUser(event.params.invoice.seller, CREATOR, event.block.timestamp);

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
  saveInvoiceEvent(event, id, INVOICE_CREATED, true);
}

export function handleMetaInvoiceCreated(event: MetaInvoiceCreatedEvent): void {
  const id = event.params.metaInvoiceId.toString();
  const metaInvoice = new MetaInvoice(id);

  const buyerId = event.transaction.from.toHex();
  trackUser(event.transaction.from, PAYER, event.block.timestamp);

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

  trackUser(event.transaction.from, PAYER, event.block.timestamp);

  const token = getOrCreatePaymentToken(event.params.paymentToken);
  const fee = getFee(amountPaid);

  invoice.buyer = buyerId;
  invoice.amountPaid = amountPaid;
  invoice.balance = amountPaid;
  invoice.state = PAID;
  invoice.escrow = event.params.escrowAddress;
  invoice.paymentToken = token.id;
  invoice.releaseAt = event.params.releaseAt;
  invoice.fee = fee;
  invoice.lastActionTime = event.block.timestamp;

  invoice.save();
  saveInvoiceEvent(event, id, INVOICE_PAID, false);

  // Funds enter escrow on payment; protocol fee is collected at the same time.
  recordPaymentVolume(event.params.paymentToken, amountPaid);
  recordEscrowDelta(event.params.paymentToken, amountPaid);

  // fee is remove at release or dispute
  recordFee(event.params.paymentToken, fee);
}

export function handleInvoiceCanceled(event: InvoiceCanceledEvent): void {
  const id = event.params.invoiceId.toString();
  const invoice = AdvancedPaymentProcessor.load(id);
  if (!invoice) return;

  invoice.state = CANCELED;
  invoice.lastActionTime = event.block.timestamp;

  invoice.save();
  saveInvoiceEvent(event, id, INVOICE_CANCELED, true);
}

export function handleDisputeCreated(event: DisputeCreatedEvent): void {
  const id = event.params.invoiceId.toString();
  const invoice = AdvancedPaymentProcessor.load(id);
  if (!invoice) return;

  invoice.state = DISPUTED;
  invoice.lastActionTime = event.block.timestamp;

  invoice.save();
  saveInvoiceEvent(event, id, DISPUTE_CREATED, true);
}

export function handleDisputeDismissed(event: DisputeDismissedEvent): void {
  const id = event.params.invoiceId.toString();
  const invoice = AdvancedPaymentProcessor.load(id);
  if (!invoice) return;

  invoice.state = DISPUTE_DISMISSED;
  invoice.lastActionTime = event.block.timestamp;

  invoice.save();
  saveInvoiceEvent(event, id, DISPUTE_DISMISSED_EVENT, true);
}

export function handleDisputeResolved(event: DisputeResolvedEvent): void {
  const id = event.params.invoiceId.toString();
  const invoice = AdvancedPaymentProcessor.load(id);
  if (!invoice) return;

  invoice.state = DISPUTE_RESOLVED;
  invoice.lastActionTime = event.block.timestamp;

  invoice.save();
  saveInvoiceEvent(event, id, DISPUTE_RESOLVED_EVENT, true);
}

export function handleDisputeSettled(event: DisputeSettledEvent): void {
  const id = event.params.invoiceId.toString();
  const invoice = AdvancedPaymentProcessor.load(id);
  if (!invoice) return;

  const priorBalance = invoice.balance ? invoice.balance! : ZERO;
  invoice.state = DISPUTE_SETTLED;
  invoice.lastActionTime = event.block.timestamp;
  invoice.balance = ZERO;
  invoice.amountReleased = event.params.sellerAmount;
  invoice.amountRefunded = event.params.buyerAmount;
  invoice.sellerAmountReceivedAfterDispute = event.params.sellerAmount;
  invoice.buyerAmountReceivedAfterDispute = event.params.buyerAmount;

  invoice.save();
  saveInvoiceEvent(event, id, DISPUTE_SETTLED_EVENT, true);

  // Full escrow is distributed between buyer and seller at settlement.
  recordEscrowDelta(invoiceToken(invoice), ZERO.minus(priorBalance));
}

export function handleRefunded(event: RefundedEvent): void {
  const id = event.params.invoiceId.toString();
  const invoice = AdvancedPaymentProcessor.load(id);
  if (!invoice) return;

  if (invoice.balance) {
    invoice.balance = invoice.balance!.minus(event.params.amount);
  }

  const previousRefunded = invoice.amountRefunded
    ? invoice.amountRefunded!
    : ZERO;

  invoice.state = REFUNDED;
  invoice.lastActionTime = event.block.timestamp;
  invoice.amountRefunded = previousRefunded.plus(event.params.amount);

  invoice.save();
  saveInvoiceEvent(event, id, REFUNDED, true);

  // Only the refunded portion leaves escrow.
  recordEscrowDelta(invoiceToken(invoice), ZERO.minus(event.params.amount));
}

export function handlePaymentReleased(event: PaymentReleasedEvent): void {
  const id = event.params.invoiceId.toString();
  const invoice = AdvancedPaymentProcessor.load(id);
  if (!invoice) return;

  const priorBalance = invoice.balance ? invoice.balance! : ZERO;
  invoice.state = RELEASED;
  invoice.lastActionTime = event.block.timestamp;
  invoice.balance = ZERO;
  invoice.amountReleased = event.params.sellerAmount;

  invoice.save();
  saveInvoiceEvent(event, id, PAYMENT_RELEASED, true);

  // All remaining escrow is released to the seller.
  recordEscrowDelta(invoiceToken(invoice), ZERO.minus(priorBalance));
}

export function handleUpdateReleaseTime(event: UpdateReleaseTimeEvent): void {
  const id = event.params.invoiceId.toString();
  const invoice = AdvancedPaymentProcessor.load(id);
  if (!invoice) return;

  invoice.releaseAt = event.block.timestamp.plus(event.params.newHoldPeriod);
  invoice.lastActionTime = event.block.timestamp;

  invoice.save();
  saveInvoiceEvent(event, id, UPDATE_RELEASE_TIME, true);
}

export function handleEscrowCreated(event: EscrowCreatedEvent): void {
  const id = event.params.invoiceId.toString();
  const invoice = AdvancedPaymentProcessor.load(id);
  if (!invoice) return;

  invoice.escrow = event.params.escrow;
  invoice.lastActionTime = event.block.timestamp;
  invoice.save();
  saveInvoiceEvent(event, id, ESCROW_CREATED, true);
}

export function handleLockedPaymentRecovered(
  event: LockedPaymentRecoveredEvent,
): void {
  const id = event.params.invoiceId.toString();
  const invoice = AdvancedPaymentProcessor.load(id);
  if (!invoice) return;

  invoice.lastActionTime = event.block.timestamp;
  invoice.save();
  saveInvoiceEvent(event, id, LOCKED_PAYMENT_RECOVERED, true);
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
  saveInvoiceEvent(event, id, TRANSFER_FAILED, true);
}
