import { Address, ethereum } from "@graphprotocol/graph-ts";
import {
  assert,
  beforeEach,
  clearStore,
  createMockedFunction,
  describe,
  test,
} from "matchstick-as/assembly/index";
import { getOrCreatePaymentToken } from "../src/util/metrics";
import { getTokenData } from "../src/util/token";

const USDC = "0x00000000000000000000000000000000000000b1";
const ZERO = "0x0000000000000000000000000000000000000000";

describe("payment tokens", () => {
  beforeEach(() => {
    clearStore();
  });

  test("the zero address is the native token, with no contract call", () => {
    // Escrows hold native currency, which has no ERC20 to interrogate.
    const data = getTokenData(Address.zero());

    assert.stringEquals(data.name, "ETH");
    assert.i32Equals(data.decimal, 18);
  });

  test("the native token is stored under the zero address", () => {
    const token = getOrCreatePaymentToken(Address.zero());

    assert.stringEquals(token.id, ZERO);
    assert.fieldEquals("PaymentToken", ZERO, "name", "ETH");
    assert.fieldEquals("PaymentToken", ZERO, "decimal", "18");
  });

  test("an ERC20's metadata is read from the contract once", () => {
    createMockedFunction(
      Address.fromString(USDC),
      "decimals",
      "decimals():(uint8)",
    ).returns([ethereum.Value.fromI32(6)]);
    createMockedFunction(
      Address.fromString(USDC),
      "name",
      "name():(string)",
    ).returns([ethereum.Value.fromString("USD Coin")]);

    getOrCreatePaymentToken(Address.fromString(USDC));
    // A second call is served from the store; re-reading would be wasted work.
    getOrCreatePaymentToken(Address.fromString(USDC));

    assert.fieldEquals("PaymentToken", USDC, "name", "USD Coin");
    assert.fieldEquals("PaymentToken", USDC, "decimal", "6");
    assert.entityCount("PaymentToken", 1);
  });
});
