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
import { Swept } from "../generated/Sweeper/Sweeper";
import { handleSwept } from "../src/sweeper";
import { creditFee, debitFee } from "../src/util/fees";

const WETH = "0x00000000000000000000000000000000000000bb";
const USDC = "0x00000000000000000000000000000000000000b1";
const RECEIVER = "0x00000000000000000000000000000000000000cc";
const OTHER = "0x00000000000000000000000000000000000000c1";
const DESTINATION = "0x00000000000000000000000000000000000000dd";

const BALANCE = "FeeReceiverTokenBalance";
const WETH_BALANCE = RECEIVER + "-" + WETH;
const USDC_BALANCE = RECEIVER + "-" + USDC;

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

function credit(receiver: string, token: string, amount: i32): void {
  creditFee(
    Address.fromString(receiver),
    Address.fromString(token),
    BigInt.fromI32(amount),
    newMockEvent(),
  );
}

function sweptEvent(
  token: string,
  from: string,
  amount: i32,
  logIndex: i32,
): Swept {
  const event = changetype<Swept>(newMockEvent());
  event.logIndex = BigInt.fromI32(logIndex);
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(
    new ethereum.EventParam(
      "token",
      ethereum.Value.fromAddress(Address.fromString(token)),
    ),
  );
  event.parameters.push(
    new ethereum.EventParam(
      "from",
      ethereum.Value.fromAddress(Address.fromString(from)),
    ),
  );
  event.parameters.push(
    new ethereum.EventParam(
      "destination",
      ethereum.Value.fromAddress(Address.fromString(DESTINATION)),
    ),
  );
  event.parameters.push(
    new ethereum.EventParam(
      "amount",
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(amount)),
    ),
  );
  return event;
}

describe("fee receiver balances", () => {
  beforeEach(() => {
    clearStore();
    mockToken(WETH, "Wrapped Ether", 18);
    mockToken(USDC, "USD Coin", 6);
  });

  test("a credited fee opens a balance and records the token", () => {
    credit(RECEIVER, WETH, 50);

    assert.fieldEquals(BALANCE, WETH_BALANCE, "accrued", "50");
    assert.fieldEquals(BALANCE, WETH_BALANCE, "swept", "0");
    assert.fieldEquals(BALANCE, WETH_BALANCE, "balance", "50");
    assert.fieldEquals(BALANCE, WETH_BALANCE, "token", WETH);
    assert.fieldEquals("PaymentToken", WETH, "name", "Wrapped Ether");
    assert.fieldEquals("PaymentToken", WETH, "decimal", "18");
    assert.fieldEquals("FeeReceiver", RECEIVER, "sweepCount", "0");
  });

  test("fees accumulate per receiver and token", () => {
    credit(RECEIVER, WETH, 50);
    credit(RECEIVER, WETH, 30);
    credit(RECEIVER, USDC, 7);

    assert.fieldEquals(BALANCE, WETH_BALANCE, "accrued", "80");
    assert.fieldEquals(BALANCE, WETH_BALANCE, "balance", "80");
    // Separate token, separate balance: raw amounts are never mixed.
    assert.fieldEquals(BALANCE, USDC_BALANCE, "accrued", "7");
    assert.entityCount(BALANCE, 2);
    assert.entityCount("FeeReceiver", 1);
  });

  test("two receivers keep separate balances", () => {
    credit(RECEIVER, WETH, 50);
    credit(OTHER, WETH, 11);

    assert.fieldEquals(BALANCE, WETH_BALANCE, "balance", "50");
    assert.fieldEquals(BALANCE, OTHER + "-" + WETH, "balance", "11");
    assert.entityCount("FeeReceiver", 2);
  });

  test("a zero fee is not recorded", () => {
    credit(RECEIVER, WETH, 0);

    assert.entityCount(BALANCE, 0);
    assert.entityCount("FeeReceiver", 0);
  });

  test("sweeping debits the balance and logs the sweep", () => {
    credit(RECEIVER, WETH, 50);
    handleSwept(sweptEvent(WETH, RECEIVER, 20, 1));

    assert.fieldEquals(BALANCE, WETH_BALANCE, "accrued", "50");
    assert.fieldEquals(BALANCE, WETH_BALANCE, "swept", "20");
    assert.fieldEquals(BALANCE, WETH_BALANCE, "balance", "30");
    assert.fieldEquals("FeeReceiver", RECEIVER, "sweepCount", "1");
    assert.entityCount("FeeSweep", 1);
  });

  test("a sweep records its destination, amount and transaction", () => {
    credit(RECEIVER, WETH, 50);
    const event = sweptEvent(WETH, RECEIVER, 20, 3);
    handleSwept(event);

    const id = event.transaction.hash.toHex() + "-" + event.logIndex.toString();
    assert.fieldEquals("FeeSweep", id, "feeReceiver", RECEIVER);
    assert.fieldEquals("FeeSweep", id, "token", WETH);
    assert.fieldEquals("FeeSweep", id, "destination", DESTINATION);
    assert.fieldEquals("FeeSweep", id, "amount", "20");
    assert.fieldEquals(
      "FeeSweep",
      id,
      "txHash",
      event.transaction.hash.toHex(),
    );
  });

  test("sweeping everything leaves a zero balance", () => {
    credit(RECEIVER, WETH, 50);
    handleSwept(sweptEvent(WETH, RECEIVER, 50, 1));

    assert.fieldEquals(BALANCE, WETH_BALANCE, "balance", "0");
    assert.fieldEquals(BALANCE, WETH_BALANCE, "swept", "50");
  });

  test("sweeping a receiver with no recorded fees opens a negative balance", () => {
    // Fees can predate the subgraph's start block, so a sweep can outrun what
    // was indexed. The arithmetic stays truthful rather than clamping.
    handleSwept(sweptEvent(WETH, RECEIVER, 20, 0));

    assert.fieldEquals(BALANCE, WETH_BALANCE, "accrued", "0");
    assert.fieldEquals(BALANCE, WETH_BALANCE, "swept", "20");
    assert.fieldEquals(BALANCE, WETH_BALANCE, "balance", "-20");
  });

  test("debiting is per token", () => {
    credit(RECEIVER, WETH, 50);
    credit(RECEIVER, USDC, 40);
    debitFee(
      Address.fromString(RECEIVER),
      Address.fromString(USDC),
      BigInt.fromI32(15),
      newMockEvent(),
    );

    assert.fieldEquals(BALANCE, WETH_BALANCE, "balance", "50");
    assert.fieldEquals(BALANCE, USDC_BALANCE, "balance", "25");
  });
});
