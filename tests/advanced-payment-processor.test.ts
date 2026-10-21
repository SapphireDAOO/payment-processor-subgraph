import { Address, BigInt, ethereum } from "@graphprotocol/graph-ts";
import {
  assert,
  beforeEach,
  clearStore,
  createMockedFunction,
  describe,
  newMockEvent,
  test,
} from "matchstick-as/assembly/index";
import {
  OracleUpdated,
  PaymentTokensRegistered,
} from "../generated/AdvancedPaymentProcessor/AdvancedPaymentProcessor";
import { AdvancedPaymentProcessor } from "../generated/schema";
import {
  handleOracleUpdated,
  handlePaymentTokensRegistered,
} from "../src/advanced-payment-processor";

const PROCESSOR = "0x00000000000000000000000000000000000000aa";
const SELLER = "0x00000000000000000000000000000000000000ee";
const USDC = "0x00000000000000000000000000000000000000b1";
const WBTC = "0x00000000000000000000000000000000000000b2";
const ORACLE_OLD = "0x00000000000000000000000000000000000000f1";
const ORACLE_NEW = "0x00000000000000000000000000000000000000f2";
const INVOICE = "1";

function mockToken(token: string, name: string, decimals: i32): void {
  createMockedFunction(
    Address.fromString(token),
    "decimals",
    "decimals():(uint8)",
  ).returns([ethereum.Value.fromI32(decimals)]);
  createMockedFunction(
    Address.fromString(token),
    "name",
    "name():(string)",
  ).returns([ethereum.Value.fromString(name)]);
}

function seedInvoice(): void {
  const invoice = new AdvancedPaymentProcessor(INVOICE);
  invoice.orderId = "order-1";
  invoice.invoiceNonce = BigInt.fromI32(1);
  invoice.state = "CREATED";
  invoice.seller = SELLER;
  invoice.price = BigInt.fromI32(1000);
  invoice.contract = Address.fromString(PROCESSOR);
  invoice.expectedPaymentTokens = [];
  invoice.save();
}

function paymentTokensRegisteredEvent(
  invoiceId: i32,
  tokens: string[],
): PaymentTokensRegistered {
  const event = changetype<PaymentTokensRegistered>(newMockEvent());
  event.address = Address.fromString(PROCESSOR);
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(
    new ethereum.EventParam(
      "invoiceId",
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(invoiceId)),
    ),
  );

  const addresses = new Array<Address>();
  for (let i = 0; i < tokens.length; i++) {
    addresses.push(Address.fromString(tokens[i]));
  }
  event.parameters.push(
    new ethereum.EventParam(
      "paymentTokens",
      ethereum.Value.fromAddressArray(addresses),
    ),
  );
  return event;
}

function oracleUpdatedEvent(logIndex: i32): OracleUpdated {
  const event = changetype<OracleUpdated>(newMockEvent());
  event.address = Address.fromString(PROCESSOR);
  event.logIndex = BigInt.fromI32(logIndex);
  event.transaction.gasPrice = BigInt.fromI32(10);
  event.transaction.gasLimit = BigInt.fromI32(100);
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(
    new ethereum.EventParam(
      "previousOracle",
      ethereum.Value.fromAddress(Address.fromString(ORACLE_OLD)),
    ),
  );
  event.parameters.push(
    new ethereum.EventParam(
      "newOracle",
      ethereum.Value.fromAddress(Address.fromString(ORACLE_NEW)),
    ),
  );
  return event;
}

describe("advanced payment processor", () => {
  beforeEach(() => {
    clearStore();
    mockToken(USDC, "USD Coin", 6);
    mockToken(WBTC, "Wrapped BTC", 8);
  });

  test("registering payment tokens records what the invoice accepts", () => {
    seedInvoice();
    handlePaymentTokensRegistered(
      paymentTokensRegisteredEvent(1, [USDC, WBTC]),
    );

    assert.fieldEquals(
      "AdvancedPaymentProcessor",
      INVOICE,
      "expectedPaymentTokens",
      "[" + USDC + ", " + WBTC + "]",
    );
  });

  test("each registered token gets its metadata resolved", () => {
    seedInvoice();
    handlePaymentTokensRegistered(
      paymentTokensRegisteredEvent(1, [USDC, WBTC]),
    );

    assert.fieldEquals("PaymentToken", USDC, "name", "USD Coin");
    assert.fieldEquals("PaymentToken", USDC, "decimal", "6");
    assert.fieldEquals("PaymentToken", WBTC, "decimal", "8");
    assert.entityCount("PaymentToken", 2);
  });

  test("a single accepted token is recorded as a one-element list", () => {
    seedInvoice();
    handlePaymentTokensRegistered(paymentTokensRegisteredEvent(1, [USDC]));

    assert.fieldEquals(
      "AdvancedPaymentProcessor",
      INVOICE,
      "expectedPaymentTokens",
      "[" + USDC + "]",
    );
  });

  test("registering for an unknown invoice is ignored", () => {
    // InvoiceCreated is emitted first in practice, but the handler must not
    // invent an invoice if it somehow arrives alone.
    handlePaymentTokensRegistered(paymentTokensRegisteredEvent(99, [USDC]));

    assert.entityCount("AdvancedPaymentProcessor", 0);
  });

  test("an oracle update is logged and its gas is accumulated", () => {
    handleOracleUpdated(oracleUpdatedEvent(0));

    assert.entityCount("InvoiceEvent", 1);
    // recordGas charges gasPrice * gasLimit against the platform wallet.
    assert.fieldEquals("GasPaid", "global", "amount", "1000");
    assert.fieldEquals("GasPaid", "global", "transactionCount", "1");
  });

  test("gas accumulates across events", () => {
    handleOracleUpdated(oracleUpdatedEvent(0));
    handleOracleUpdated(oracleUpdatedEvent(1));

    assert.fieldEquals("GasPaid", "global", "amount", "2000");
    assert.fieldEquals("GasPaid", "global", "transactionCount", "2");
    assert.entityCount("InvoiceEvent", 2);
  });
});
