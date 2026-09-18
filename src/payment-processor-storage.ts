import { BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import {
  AuthorizationUpdated,
  ConfigurationInitialized,
  EmergencyPauseApproved,
  EmergencyPaused,
  FeeRateUpdated,
  FeeReceiverUpdated,
  GasThresholdUpdated,
  OwnershipTransferred,
  Paused,
  PaymentValidityDurationUpdated,
  Unpaused,
} from "../generated/PaymentProcessorStorage/PaymentProcessorStorage";
import {
  AuthorizedAddress,
  PauseAction,
  PauseState,
  StorageConfiguration,
} from "../generated/schema";
import {
  EMERGENCY_PAUSED_ACTION,
  EMERGENCY_PAUSE_APPROVED_ACTION,
  GLOBAL,
  PAUSED_ACTION,
  UNPAUSED_ACTION,
} from "./util/constants";

function getConfiguration(event: ethereum.Event): StorageConfiguration {
  let config = StorageConfiguration.load(GLOBAL);
  if (config == null) {
    config = new StorageConfiguration(GLOBAL);
  }
  config.updatedAt = event.block.timestamp;
  config.updatedAtBlock = event.block.number;
  return config;
}

function getPauseState(): PauseState {
  let state = PauseState.load(GLOBAL);
  if (state == null) {
    state = new PauseState(GLOBAL);
    state.ownerPaused = false;
  }
  return state;
}

// Appends to the pause log and stamps the action onto the singleton.
function recordPauseAction(
  event: ethereum.Event,
  state: PauseState,
  type: string,
  account: Bytes,
  expiry: BigInt | null,
): void {
  const action = new PauseAction(
    event.transaction.hash.toHex() + "-" + event.logIndex.toString(),
  );
  action.type = type;
  action.account = account;
  action.expiry = expiry;
  action.timestamp = event.block.timestamp;
  action.block = event.block.number;
  action.txHash = event.transaction.hash;
  action.save();

  state.lastAction = type;
  state.lastActionBy = account;
  state.lastActionAt = event.block.timestamp;
  state.lastActionTx = event.transaction.hash;
  state.save();
}

export function handlePaused(event: Paused): void {
  const state = getPauseState();
  state.ownerPaused = true;
  recordPauseAction(event, state, PAUSED_ACTION, event.params.account, null);
}

export function handleUnpaused(event: Unpaused): void {
  const state = getPauseState();
  state.ownerPaused = false;
  state.emergencyPauseExpiry = null;
  state.emergencyPausedBy = null;
  state.emergencyPausedAt = null;
  recordPauseAction(event, state, UNPAUSED_ACTION, event.params.account, null);
}

export function handleEmergencyPaused(event: EmergencyPaused): void {
  const state = getPauseState();
  state.emergencyPauseExpiry = event.params.expiry;
  state.emergencyPausedBy = event.params.account;
  state.emergencyPausedAt = event.block.timestamp;
  recordPauseAction(
    event,
    state,
    EMERGENCY_PAUSED_ACTION,
    event.params.account,
    event.params.expiry,
  );
}

export function handleEmergencyPauseApproved(
  event: EmergencyPauseApproved,
): void {
  // The owner promotes a live emergency pause into a standing one, which no
  // longer expires on its own.
  const state = getPauseState();
  state.ownerPaused = true;
  state.emergencyPauseExpiry = null;
  state.emergencyPausedBy = null;
  state.emergencyPausedAt = null;
  recordPauseAction(
    event,
    state,
    EMERGENCY_PAUSE_APPROVED_ACTION,
    event.params.account,
    null,
  );
}

export function handleAuthorizationUpdated(event: AuthorizationUpdated): void {
  const id = event.params.account.toHex();
  let authorized = AuthorizedAddress.load(id);
  if (authorized == null) {
    authorized = new AuthorizedAddress(id);
    authorized.account = event.params.account;
  }
  authorized.authorized = event.params.authorized;
  authorized.updatedAt = event.block.timestamp;
  authorized.updatedAtBlock = event.block.number;
  authorized.save();
}

export function handleConfigurationInitialized(
  event: ConfigurationInitialized,
): void {
  const c = event.params.config;
  const config = getConfiguration(event);
  config.owner = c.owner;
  config.feeRate = c.feeRate;
  config.feeReceiver = c.feeReceiver;
  config.gasThreshold = c.gasThreshold;
  config.save();
}

export function handleFeeRateUpdated(event: FeeRateUpdated): void {
  const config = getConfiguration(event);
  config.feeRate = event.params.feeRate;
  config.save();
}

export function handleFeeReceiverUpdated(event: FeeReceiverUpdated): void {
  const config = getConfiguration(event);
  config.feeReceiver = event.params.feeReceiver;
  config.save();
}

export function handleGasThresholdUpdated(event: GasThresholdUpdated): void {
  const config = getConfiguration(event);
  config.gasThreshold = event.params.gasThreshold;
  config.save();
}

export function handleOwnershipTransferred(event: OwnershipTransferred): void {
  const config = getConfiguration(event);
  config.owner = event.params.newOwner;
  config.save();
}

export function handlePaymentValidityDurationUpdated(
  event: PaymentValidityDurationUpdated,
): void {
  const config = getConfiguration(event);
  config.paymentValidityDuration = event.params.validityDuration;
  config.save();
}
