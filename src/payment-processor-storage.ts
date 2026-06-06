import { BigInt, ethereum } from "@graphprotocol/graph-ts";
import {
  AuthorizationUpdated,
  ConfigurationInitialized,
  DefaultHoldPeriodUpdated,
  FeeRateUpdated,
  FeeReceiverUpdated,
  GasThresholdUpdated,
  MarketplaceUpdated,
  OwnershipTransferred,
  PaymentValidityDurationUpdated,
} from "../generated/PaymentProcessorStorage/PaymentProcessorStorage";
import {
  AuthorizedAddress,
  StorageConfiguration,
} from "../generated/schema";
import { GLOBAL } from "./util/constants";

function getConfiguration(event: ethereum.Event): StorageConfiguration {
  let config = StorageConfiguration.load(GLOBAL);
  if (config == null) {
    config = new StorageConfiguration(GLOBAL);
  }
  config.updatedAt = event.block.timestamp;
  config.updatedAtBlock = event.block.number;
  return config;
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
  config.defaultHoldPeriod = c.defaultHoldPeriod;
  config.marketplace = c.marketplace;
  config.gasThreshold = c.gasThreshold;
  config.save();
}

export function handleDefaultHoldPeriodUpdated(
  event: DefaultHoldPeriodUpdated,
): void {
  const config = getConfiguration(event);
  config.defaultHoldPeriod = event.params.defaultHoldPeriod;
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

export function handleMarketplaceUpdated(event: MarketplaceUpdated): void {
  const config = getConfiguration(event);
  config.marketplace = event.params.marketplace;
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

// The default hold period is read from the StorageConfiguration singleton, which
// is kept current by this data source's config event handlers. Returns zero
// until the relevant config event has been indexed.
export function getDefaultHoldPeriod(): BigInt {
  const config = StorageConfiguration.load(GLOBAL);
  if (config == null || config.defaultHoldPeriod === null) {
    return BigInt.zero();
  }
  return config.defaultHoldPeriod!;
}
