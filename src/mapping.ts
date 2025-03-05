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
  SetInvoiceHoldPeriodCall,
} from "../generated/PaymentProcessorV1/PaymentProcessorV1";
import { Invoice, User } from "../generated/schema";

const PAYMENT_PROCESSOR_CONTRACT_ADDRESS =
  "0x3aceBd0b7024CB53880A397c763Ef658DfCD10e6";

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
  entity.save();
}

export function handleHoldPeriod(func: SetInvoiceHoldPeriodCall): void {
  let invoiceId = func.inputs._invoiceId;
  let entity = Invoice.load(invoiceId.toString());
  if (!entity) return;

  const holdPeriod = func.inputs._holdPeriod.plus(func.block.timestamp);

  entity.holdPeriod = holdPeriod;
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

  entity.payer = invoicePayer;
  entity.paidAt = event.block.timestamp;
  entity.status = "PAID";
  entity.amountPaid = event.params.amountPaid;

  entity.save();
}

export function handleInvoiceAccepted(event: InvoiceAcceptedEvent): void {
  let entity = Invoice.load(event.params.invoiceId.toString());
  if (!entity) return;

  const pp = PaymentProcessorV1.bind(
    Address.fromString(PAYMENT_PROCESSOR_CONTRACT_ADDRESS)
  );

  if (!entity.holdPeriod)
    entity.holdPeriod = event.block.timestamp.plus(pp.getDefaultHoldPeriod());

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
