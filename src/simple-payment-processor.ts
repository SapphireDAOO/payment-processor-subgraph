import { Address, BigInt, ethereum } from "@graphprotocol/graph-ts";
import {
  InvoiceAccepted as InvoiceAcceptedEvent,
  InvoiceCanceled as InvoiceCanceledEvent,
  InvoiceCreated as InvoiceCreatedEvent,
  InvoicePaid as InvoicePaidEvent,
  InvoiceRefunded as InvoiceRefundedEvent,
  InvoiceRejected as InvoiceRejectedEvent,
  InvoiceReleased as InvoiceReleasedEvent,
  TransferFailed as TransferFailedEvent,
  WithdrawalRetried as WithdrawalRetriedEvent,
  SimplePaymentProcessor as SimplePaymentProcessorContract,
} from "../generated/SimplePaymentProcessor/SimplePaymentProcessor";
import {
  InvoiceEvent,
  SimplePaymentProcessor,
  StorageConfiguration,
} from "../generated/schema";
import {
  recordEscrowDelta,
  recordFee,
  recordInvoiceActivity,
  recordPaymentVolume,
} from "./util/metrics";
import { trackUser } from "./util/user";
import { creditFee } from "./util/fees";
import {
  ACCEPTED,
  CANCELED,
  CREATED,
  CREATOR,
  ETH,
  GLOBAL,
  INVOICE_ACCEPTED,
  INVOICE_CANCELED,
  INVOICE_CREATED,
  INVOICE_PAID,
  INVOICE_REFUNDED,
  INVOICE_REJECTED,
  INVOICE_RELEASED,
  PAID,
  PAYER,
  REFUNDED,
  REJECTED,
  RELEASED,
  SIMPLE,
  TRANSFER_FAILED,
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

// Mirrors the contract's _feeReceiverFor: the invoice's own receiver, falling
// back to the global one configured in PaymentProcessorStorage.
function resolveFeeReceiver(invoice: SimplePaymentProcessor): Address {
  const invoiceReceiver = invoice.feeReceiver;
  if (invoiceReceiver !== null) {
    return Address.fromBytes(invoiceReceiver);
  }

  const config = StorageConfiguration.load(GLOBAL);
  if (config != null && config.feeReceiver !== null) {
    return Address.fromBytes(config.feeReceiver!);
  }
  return Address.zero();
}

// The simple processor pays its fee as wrapped native, so fee balances are
// denominated in WETH rather than ETH.
function feeToken(contractAddress: Address): Address {
  const wethCall = SimplePaymentProcessorContract.bind(contractAddress).try_weth();
  return wethCall.reverted ? Address.zero() : wethCall.value;
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
  invoice.expiresAt = event.params.invoice.expiresAt;

  invoice.save();
  saveInvoiceEvent(event, id, INVOICE_CREATED);
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
  invoice.sellerActionDeadline = event.params.sellerActionDeadline;

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
  invoice.feeReceiver = event.params.feeReceiver;
  invoice.releaseAt = event.params.releaseAt;
  invoice.lastActionTime = event.block.timestamp;

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

  // _autoRelease pays the fee best-effort and emits TransferFailed before this
  // event when it does not land, so skip crediting that case.
  const failedTx = invoice.feeTransferFailedTx;
  if (failedTx !== null && failedTx.equals(event.transaction.hash)) return;
  creditFee(
    resolveFeeReceiver(invoice),
    feeToken(event.address),
    event.params.fee,
    event,
  );
}

export function handleTransferFailed(event: TransferFailedEvent): void {
  const id = event.params.invoiceId.toString();
  const invoice = SimplePaymentProcessor.load(id);
  if (!invoice) return;

  // The processor emits TransferFailed for a failed buyer refund, a failed burn
  // and a failed fee payout; only the last one targets the fee receiver.
  if (event.params.recipient.equals(resolveFeeReceiver(invoice))) {
    invoice.feeTransferFailedTx = event.transaction.hash;
  }

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
