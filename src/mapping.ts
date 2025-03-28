import { Address } from "@graphprotocol/graph-ts";
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

const PAYMENT_PROCESSOR_CONTRACT_ADDRESS =
  "0xe067ec2b51f1d623824089b81c54a2097e38880c";

export function handleInvoiceCreated(event: InvoiceCreatedEvent): void {
  let entity = new Invoice(event.params.invoiceId.toString());

  const invoiceCreator = event.params.creator.toHex();
  let user = User.load(invoiceCreator);

  if (!user) {
    user = new User(invoiceCreator);
    user.save();
  }

  entity.status = "CREATED";
  entity.creator = invoiceCreator;
  entity.createdAt = event.block.timestamp;
  entity.price = event.params.price;
  entity.contract = event.address;
  entity.save();
}

export function handleHoldPeriod(event: UpdateHoldPeriodEvent): void {
  let invoiceId = event.params.invoiceId;
  let entity = Invoice.load(invoiceId.toString());
  if (!entity) return;

  entity.releasedAt = event.params.releaseDueTimestamp;
  entity.releaseHash = event.transaction.hash;
  entity.save();
}

export function handleInvoicePaid(event: InvoicePaidEvent): void {
  let invoicePayer = event.params.payer.toHex();
  let entity = Invoice.load(event.params.invoiceId.toString());

  if (!entity) return;

  let user = User.load(invoicePayer);
  if (!user) {
    user = new User(invoicePayer);
    user.save();
  }

  const pp = PaymentProcessorV1.bind(
    Address.fromString(PAYMENT_PROCESSOR_CONTRACT_ADDRESS)
  );

  const fee = pp.calculateFee(event.params.amountPaid);

  entity.payer = invoicePayer;
  entity.paidAt = event.block.timestamp;
  entity.status = "PAID";
  entity.amountPaid = event.params.amountPaid;
  entity.paymentTxHash = event.transaction.hash;
  entity.fee = fee;

  entity.save();
}

export function handleInvoiceAccepted(event: InvoiceAcceptedEvent): void {
  let entity = Invoice.load(event.params.invoiceId.toString());
  if (!entity) return;

  const pp = PaymentProcessorV1.bind(
    Address.fromString(PAYMENT_PROCESSOR_CONTRACT_ADDRESS)
  );

  if (!entity.releasedAt)
    entity.releasedAt = event.block.timestamp.plus(pp.getDefaultHoldPeriod());

  entity.status = "ACCEPTED";

  entity.save();
}

export function handleInvoiceCanceled(event: InvoiceCanceledEvent): void {
  let entity = Invoice.load(event.params.invoiceId.toString());
  if (!entity) return;

  entity.status = "CANCELED";

  entity.save();
}

export function handleInvoiceRefunded(event: InvoiceRefundedEvent): void {
  let entity = Invoice.load(event.params.invoiceId.toString());
  if (!entity) return;

  entity.status = "REFUNDED";

  entity.save();
}

export function handleInvoiceRejected(event: InvoiceRejectedEvent): void {
  let entity = Invoice.load(event.params.invoiceId.toString());
  if (!entity) return;

  entity.status = "REJECTED";

  entity.save();
}

export function handleInvoiceReleased(event: InvoiceReleasedEvent): void {
  let entity = Invoice.load(event.params.invoiceId.toString());
  if (!entity) return;

  entity.status = "RELEASED";

  entity.save();
}
