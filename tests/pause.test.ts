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
  EmergencyPauseApproved,
  EmergencyPaused,
  Paused,
  Unpaused,
} from "../generated/PaymentProcessorStorage/PaymentProcessorStorage";
import {
  handleEmergencyPauseApproved,
  handleEmergencyPaused,
  handlePaused,
  handleUnpaused,
} from "../src/payment-processor-storage";

const OWNER = "0x0000000000000000000000000000000000000001";
const PAUSER = "0x0000000000000000000000000000000000000002";
const STATE = "PauseState";
const ID = "global";

function accountParam(account: string): ethereum.EventParam {
  return new ethereum.EventParam(
    "account",
    ethereum.Value.fromAddress(Address.fromString(account)),
  );
}

function pausedEvent(account: string, logIndex: i32 = 0): Paused {
  const event = changetype<Paused>(newMockEvent());
  event.logIndex = BigInt.fromI32(logIndex);
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(accountParam(account));
  return event;
}

function unpausedEvent(account: string, logIndex: i32 = 1): Unpaused {
  const event = changetype<Unpaused>(newMockEvent());
  event.logIndex = BigInt.fromI32(logIndex);
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(accountParam(account));
  return event;
}

function approvedEvent(
  account: string,
  logIndex: i32 = 1,
): EmergencyPauseApproved {
  const event = changetype<EmergencyPauseApproved>(newMockEvent());
  event.logIndex = BigInt.fromI32(logIndex);
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(accountParam(account));
  return event;
}

function emergencyPausedEvent(
  account: string,
  expiry: i32,
  logIndex: i32 = 0,
): EmergencyPaused {
  const event = changetype<EmergencyPaused>(newMockEvent());
  event.logIndex = BigInt.fromI32(logIndex);
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(accountParam(account));
  event.parameters.push(
    new ethereum.EventParam(
      "expiry",
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(expiry)),
    ),
  );
  return event;
}

describe("pause state", () => {
  beforeEach(() => {
    clearStore();
  });

  test("pause sets the standing pause and logs the action", () => {
    handlePaused(pausedEvent(OWNER));

    assert.fieldEquals(STATE, ID, "ownerPaused", "true");
    assert.fieldEquals(STATE, ID, "lastAction", "PAUSED");
    assert.fieldEquals(STATE, ID, "lastActionBy", OWNER);
    assert.entityCount("PauseAction", 1);
  });

  test("unpause clears the standing pause", () => {
    handlePaused(pausedEvent(OWNER));
    handleUnpaused(unpausedEvent(OWNER));

    assert.fieldEquals(STATE, ID, "ownerPaused", "false");
    assert.fieldEquals(STATE, ID, "lastAction", "UNPAUSED");
    assert.entityCount("PauseAction", 2);
  });

  test("emergency pause records an expiry without a standing pause", () => {
    handleEmergencyPaused(emergencyPausedEvent(PAUSER, 86400));

    assert.fieldEquals(STATE, ID, "ownerPaused", "false");
    assert.fieldEquals(STATE, ID, "emergencyPauseExpiry", "86400");
    assert.fieldEquals(STATE, ID, "emergencyPausedBy", PAUSER);
    assert.fieldEquals(STATE, ID, "lastAction", "EMERGENCY_PAUSED");
  });

  test("approval promotes an emergency pause into a standing one", () => {
    handleEmergencyPaused(emergencyPausedEvent(PAUSER, 86400));
    handleEmergencyPauseApproved(approvedEvent(OWNER));

    assert.fieldEquals(STATE, ID, "ownerPaused", "true");
    assert.fieldEquals(STATE, ID, "lastAction", "EMERGENCY_PAUSE_APPROVED");
    // The timer is gone, so the pause no longer lapses on its own.
    assert.fieldEquals(STATE, ID, "emergencyPauseExpiry", "null");
  });

  test("unpause also clears a live emergency pause", () => {
    handleEmergencyPaused(emergencyPausedEvent(PAUSER, 86400));
    handleUnpaused(unpausedEvent(OWNER));

    assert.fieldEquals(STATE, ID, "ownerPaused", "false");
    assert.fieldEquals(STATE, ID, "emergencyPauseExpiry", "null");
  });

  test("each action records its transaction and timestamp", () => {
    const event = pausedEvent(OWNER);
    handlePaused(event);

    const id = event.transaction.hash.toHex() + "-" + event.logIndex.toString();
    assert.fieldEquals("PauseAction", id, "type", "PAUSED");
    assert.fieldEquals("PauseAction", id, "account", OWNER);
    assert.fieldEquals("PauseAction", id, "txHash", event.transaction.hash.toHex());
    assert.fieldEquals("PauseAction", id, "timestamp", event.block.timestamp.toString());
  });
});
