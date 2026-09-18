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
import { PriceFeedSet } from "../generated/OracleManager/OracleManager";
import { handlePriceFeedSet } from "../src/oracle-manager";

const USDC = "0x00000000000000000000000000000000000000b1";
const AGGREGATOR = "0x00000000000000000000000000000000000000e1";

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

function mockRevertingToken(token: string): void {
  createMockedFunction(
    Address.fromString(token),
    "decimals",
    "decimals():(uint8)",
  ).reverts();
  createMockedFunction(
    Address.fromString(token),
    "name",
    "name():(string)",
  ).reverts();
}

function priceFeedSetEvent(token: string): PriceFeedSet {
  const event = changetype<PriceFeedSet>(newMockEvent());
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(
    new ethereum.EventParam(
      "token",
      ethereum.Value.fromAddress(Address.fromString(token)),
    ),
  );
  event.parameters.push(
    new ethereum.EventParam(
      "aggregator",
      ethereum.Value.fromAddress(Address.fromString(AGGREGATOR)),
    ),
  );
  event.parameters.push(
    new ethereum.EventParam(
      "heartbeat",
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(3600)),
    ),
  );
  return event;
}

describe("oracle manager", () => {
  beforeEach(() => {
    clearStore();
  });

  test("registering a feed records the token's metadata", () => {
    mockToken(USDC, "USD Coin", 6);
    handlePriceFeedSet(priceFeedSetEvent(USDC));

    assert.fieldEquals("PaymentToken", USDC, "name", "USD Coin");
    assert.fieldEquals("PaymentToken", USDC, "decimal", "6");
  });

  test("a token already known is left untouched", () => {
    mockToken(USDC, "USD Coin", 6);
    handlePriceFeedSet(priceFeedSetEvent(USDC));

    // A later feed change must not overwrite metadata already recorded.
    mockToken(USDC, "Renamed", 18);
    handlePriceFeedSet(priceFeedSetEvent(USDC));

    assert.fieldEquals("PaymentToken", USDC, "name", "USD Coin");
    assert.fieldEquals("PaymentToken", USDC, "decimal", "6");
    assert.entityCount("PaymentToken", 1);
  });

  test("a token whose metadata calls revert still gets an entity", () => {
    // Non-standard ERC20s should not abort indexing.
    mockRevertingToken(USDC);
    handlePriceFeedSet(priceFeedSetEvent(USDC));

    assert.entityCount("PaymentToken", 1);
    assert.fieldEquals("PaymentToken", USDC, "decimal", "0");
    // getTokenData falls back to an empty name, which matchstick renders as
    // "null" in its store.
    assert.fieldEquals("PaymentToken", USDC, "name", "null");
  });
});
