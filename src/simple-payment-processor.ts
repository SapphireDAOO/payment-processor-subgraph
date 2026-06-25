import { BigInt, ethereum } from "@graphprotocol/graph-ts";
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
import { InvoiceEvent, SimplePaymentProcessor } from "../generated/schema";
import { getDefaultHoldPeriod } from "./payment-processor-storage";
import {
  recordEscrowDelta,
  recordFee,
  recordInvoiceActivity,
  recordPaymentVolume,
} from "./util/metrics";
import { trackUser } from "./util/user";
import {
  ACCEPTED,
  CANCELED,
  CREATED,
  CREATOR,
  ETH,
  INVOICE_ACCEPTED,
  INVOICE_CANCELED,
  INVOICE_CREATED,
  INVOICE_PAID,
  INVOICE_REFUNDED,
  INVOICE_REJECTED,
  INVOICE_RELEASED,
  LOCKED_PAYMENT_RECOVERED,
  PAID,
  PAYER,
  REFUNDED,
  REJECTED,
  RELEASED,
  SIMPLE,
  TRANSFER_FAILED,
  UPDATE_HOLD_PERIOD,
  WITHDRAWAL_RETRIED,
  ZERO,
} from "./util/constants";

function eventId(event: ethereum.Event): string {
  return event.transaction.hash.toHex() + "-" + event.logIndex.toString();
}

function saveInvoiceEvent(
  event: ethereum.Event,
  invoiceId: string,
  eventType: string,
): void {
  const invoiceEvent = new InvoiceEvent(eventId(event));
  invoiceEvent.eventType = eventType;
  invoiceEvent.txHash = event.transaction.hash;
  invoiceEvent.timestamp = event.block.timestamp;
  invoiceEvent.simpleInvoice = invoiceId;
  invoiceEvent.save();

  recordInvoiceActivity(SIMPLE);
}

function isEscrowed(state: string): boolean {
  return state == PAID || state == ACCEPTED;
}

function reverseEscrow(wasEscrowed: boolean, amount: BigInt): void {
  if (!wasEscrowed) return;
  recordEscrowDelta(ETH, amount.neg());
}

export function handleInvoiceCreated(event: InvoiceCreatedEvent): void {
  const id = event.params.invoiceId.toString();
  const invoice = new SimplePaymentProcessor(id);

  const sellerId = event.params.invoice.seller.toHex();
  trackUser(event.params.invoice.seller, CREATOR, event.block.timestamp);

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
  trackUser(event.params.buyer, PAYER, event.block.timestamp);

  invoice.buyer = buyerId;
  invoice.state = PAID;
  invoice.amountPaid = event.params.amountPaid;
  invoice.lastActionTime = event.block.timestamp;
  invoice.expiresAt = event.params.expiresAt;

  invoice.save();
  saveInvoiceEvent(event, id, INVOICE_PAID);

  // Funds enter native-token escrow on payment.
  recordPaymentVolume(ETH, event.params.amountPaid);
  recordEscrowDelta(ETH, event.params.amountPaid);
}

export function handleInvoiceAccepted(event: InvoiceAcceptedEvent): void {
  const id = event.params.invoiceId.toString();
  const invoice = SimplePaymentProcessor.load(id);
  if (!invoice) return;

  invoice.state = ACCEPTED;
  invoice.lastActionTime = event.block.timestamp;

  if (!invoice.releaseAt) {
    invoice.releaseAt = event.block.timestamp.plus(getDefaultHoldPeriod());
  }

  invoice.save();
  saveInvoiceEvent(event, id, INVOICE_ACCEPTED);
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

  const wasEscrowed = isEscrowed(invoice.state);
  invoice.state = REFUNDED;
  invoice.lastActionTime = event.block.timestamp;

  invoice.save();
  saveInvoiceEvent(event, id, INVOICE_REFUNDED);
  // Only the refunded portion leaves escrow.
  reverseEscrow(wasEscrowed, event.params.amount);
}

export function handleInvoiceRejected(event: InvoiceRejectedEvent): void {
  const id = event.params.invoiceId.toString();
  const invoice = SimplePaymentProcessor.load(id);
  if (!invoice) return;

  const wasEscrowed = isEscrowed(invoice.state);
  invoice.state = REJECTED;
  invoice.lastActionTime = event.block.timestamp;

  invoice.save();
  saveInvoiceEvent(event, id, INVOICE_REJECTED);
  // The amount returned to the buyer leaves escrow.
  reverseEscrow(wasEscrowed, event.params.amount);
}

export function handleInvoiceReleased(event: InvoiceReleasedEvent): void {
  const id = event.params.invoiceId.toString();
  const invoice = SimplePaymentProcessor.load(id);
  if (!invoice) return;

  const wasEscrowed = isEscrowed(invoice.state);
  invoice.state = RELEASED;
  invoice.fee = event.params.fee;
  invoice.lastActionTime = event.block.timestamp;

  invoice.save();
  saveInvoiceEvent(event, id, INVOICE_RELEASED);
  // The full escrowed amount (seller payout plus fee) is released.
  reverseEscrow(wasEscrowed, invoice.amountPaid ? invoice.amountPaid! : ZERO);

  // Protocol fee is collected when the payment is released to the seller.
  recordFee(ETH, event.params.fee, event.transaction.hash);
}

export function handleLockedPaymentRecovered(
  event: LockedPaymentRecoveredEvent,
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
