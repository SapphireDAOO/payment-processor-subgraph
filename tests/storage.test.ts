import { Address, ethereum } from "@graphprotocol/graph-ts";
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
  FeeSignerUpdated,
  IntermediatedPlatformsOperatorUpdated,
} from "../generated/PaymentProcessorStorage/PaymentProcessorStorage";
import {
  handleAuthorizationUpdated,
  handleConfigurationInitialized,
  handleFeeSignerUpdated,
  handleIntermediatedPlatformsOperatorUpdated,
} from "../src/payment-processor-storage";

const OWNER = "0x0000000000000000000000000000000000000001";
const RECEIVER = "0x00000000000000000000000000000000000000cc";
const OPERATOR = "0x00000000000000000000000000000000000000c2";
const NEW_OPERATOR = "0x00000000000000000000000000000000000000c3";
const WETH = "0x00000000000000000000000000000000000000bb";
const SIGNER = "0x00000000000000000000000000000000000000f5";
const ACCOUNT = "0x00000000000000000000000000000000000000a1";
const CONFIG = "StorageConfiguration";
const ID = "global";

function configInitializedEvent(): ConfigurationInitialized {
  const event = changetype<ConfigurationInitialized>(newMockEvent());
  event.parameters = new Array<ethereum.EventParam>();

  // struct Configuration(owner, feeReceiver, intermediatedPlatformsOperator, weth)
  const tuple = new ethereum.Tuple();
  tuple.push(ethereum.Value.fromAddress(Address.fromString(OWNER)));
  tuple.push(ethereum.Value.fromAddress(Address.fromString(RECEIVER)));
  tuple.push(ethereum.Value.fromAddress(Address.fromString(OPERATOR)));
  tuple.push(ethereum.Value.fromAddress(Address.fromString(WETH)));

  event.parameters.push(
    new ethereum.EventParam("config", ethereum.Value.fromTuple(tuple)),
  );
  return event;
}

function operatorUpdatedEvent(
  operator: string,
): IntermediatedPlatformsOperatorUpdated {
  const event =
    changetype<IntermediatedPlatformsOperatorUpdated>(newMockEvent());
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(
    new ethereum.EventParam(
      "intermediatedPlatformsOperator",
      ethereum.Value.fromAddress(Address.fromString(operator)),
    ),
  );
  return event;
}

function feeSignerUpdatedEvent(signer: string): FeeSignerUpdated {
  const event = changetype<FeeSignerUpdated>(newMockEvent());
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(
    new ethereum.EventParam(
      "feeSigner",
      ethereum.Value.fromAddress(Address.fromString(signer)),
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
    assert.fieldEquals(CONFIG, ID, "feeReceiver", RECEIVER);
    assert.fieldEquals(CONFIG, ID, "intermediatedPlatformsOperator", OPERATOR);
    assert.fieldEquals(CONFIG, ID, "weth", WETH);
  });

  test("later events update the singleton in place", () => {
    handleConfigurationInitialized(configInitializedEvent());
    handleIntermediatedPlatformsOperatorUpdated(
      operatorUpdatedEvent(NEW_OPERATOR),
    );
    handleFeeSignerUpdated(feeSignerUpdatedEvent(SIGNER));

    assert.fieldEquals(
      CONFIG,
      ID,
      "intermediatedPlatformsOperator",
      NEW_OPERATOR,
    );
    assert.fieldEquals(CONFIG, ID, "feeSigner", SIGNER);
    // Untouched fields survive.
    assert.fieldEquals(CONFIG, ID, "owner", OWNER);
    assert.fieldEquals(CONFIG, ID, "weth", WETH);
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
