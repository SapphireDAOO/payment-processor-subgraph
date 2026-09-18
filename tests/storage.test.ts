import { Address, BigInt, ethereum } from "@graphprotocol/graph-ts";
import {
  assert,
  beforeEach,
  clearStore,
  describe,
  newMockEvent,
  test,
} from "matchstick-as/assembly/index";
import {
  AuthorizationUpdated,
  ConfigurationInitialized,
  FeeRateUpdated,
  FeeReceiverUpdated,
} from "../generated/PaymentProcessorStorage/PaymentProcessorStorage";
import {
  handleAuthorizationUpdated,
  handleConfigurationInitialized,
  handleFeeRateUpdated,
  handleFeeReceiverUpdated,
} from "../src/payment-processor-storage";

const OWNER = "0x0000000000000000000000000000000000000001";
const RECEIVER = "0x00000000000000000000000000000000000000cc";
const OPERATOR = "0x00000000000000000000000000000000000000c2";
const ACCOUNT = "0x00000000000000000000000000000000000000a1";
const CONFIG = "StorageConfiguration";
const ID = "global";

function configInitializedEvent(): ConfigurationInitialized {
  const event = changetype<ConfigurationInitialized>(newMockEvent());
  event.parameters = new Array<ethereum.EventParam>();

  // struct Configuration(owner, feeRate, feeReceiver, operator, gasThreshold)
  const tuple = new ethereum.Tuple();
  tuple.push(ethereum.Value.fromAddress(Address.fromString(OWNER)));
  tuple.push(ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(500)));
  tuple.push(ethereum.Value.fromAddress(Address.fromString(RECEIVER)));
  tuple.push(ethereum.Value.fromAddress(Address.fromString(OPERATOR)));
  tuple.push(ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(21000)));

  event.parameters.push(
    new ethereum.EventParam("config", ethereum.Value.fromTuple(tuple)),
  );
  return event;
}

function feeReceiverUpdatedEvent(receiver: string): FeeReceiverUpdated {
  const event = changetype<FeeReceiverUpdated>(newMockEvent());
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(
    new ethereum.EventParam(
      "feeReceiver",
      ethereum.Value.fromAddress(Address.fromString(receiver)),
    ),
  );
  return event;
}

function feeRateUpdatedEvent(rate: i32): FeeRateUpdated {
  const event = changetype<FeeRateUpdated>(newMockEvent());
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(
    new ethereum.EventParam(
      "feeRate",
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(rate)),
    ),
  );
  return event;
}

function authorizationUpdatedEvent(
  account: string,
  authorized: boolean,
): AuthorizationUpdated {
  const event = changetype<AuthorizationUpdated>(newMockEvent());
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(
    new ethereum.EventParam(
      "account",
      ethereum.Value.fromAddress(Address.fromString(account)),
    ),
  );
  event.parameters.push(
    new ethereum.EventParam(
      "authorized",
      ethereum.Value.fromBoolean(authorized),
    ),
  );
  return event;
}

describe("storage configuration", () => {
  beforeEach(() => {
    clearStore();
  });

  test("initialization mirrors the configuration struct", () => {
    handleConfigurationInitialized(configInitializedEvent());

    assert.fieldEquals(CONFIG, ID, "owner", OWNER);
    assert.fieldEquals(CONFIG, ID, "feeRate", "500");
    assert.fieldEquals(CONFIG, ID, "feeReceiver", RECEIVER);
    assert.fieldEquals(CONFIG, ID, "gasThreshold", "21000");
  });

  test("later events update the singleton in place", () => {
    handleConfigurationInitialized(configInitializedEvent());
    handleFeeReceiverUpdated(feeReceiverUpdatedEvent(OPERATOR));
    handleFeeRateUpdated(feeRateUpdatedEvent(250));

    assert.fieldEquals(CONFIG, ID, "feeReceiver", OPERATOR);
    assert.fieldEquals(CONFIG, ID, "feeRate", "250");
    // Untouched fields survive.
    assert.fieldEquals(CONFIG, ID, "owner", OWNER);
    assert.entityCount(CONFIG, 1);
  });

  test("authorization is tracked per account and can be revoked", () => {
    handleAuthorizationUpdated(authorizationUpdatedEvent(ACCOUNT, true));
    assert.fieldEquals("AuthorizedAddress", ACCOUNT, "authorized", "true");

    handleAuthorizationUpdated(authorizationUpdatedEvent(ACCOUNT, false));
    assert.fieldEquals("AuthorizedAddress", ACCOUNT, "authorized", "false");
    assert.entityCount("AuthorizedAddress", 1);
  });
});
