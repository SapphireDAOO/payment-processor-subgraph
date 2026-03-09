import { Address, BigInt } from "@graphprotocol/graph-ts";
import { PaymentProcessorStorage } from "../../generated/AdvancedPaymentProcessor/PaymentProcessorStorage";

const STORAGE_ADDRESS = "0x5214b494598c706a482a36dc6fece2fdaff3390d";

function bindStorage(): PaymentProcessorStorage {
  return PaymentProcessorStorage.bind(Address.fromString(STORAGE_ADDRESS));
}

export function getDefaultHoldPeriod(): BigInt {
  const result = bindStorage().try_getDefaultHoldPeriod();
  return result.reverted ? BigInt.zero() : result.value;
}

export function getFee(amount: BigInt): BigInt {
  const result = bindStorage().try_getFeeRate();
  if (result.reverted) return BigInt.zero();

  const feeRate = result.value;
  const denominator = BigInt.fromI32(10_000);

  return denominator.notEqual(BigInt.zero())
    ? amount.times(feeRate).div(denominator)
    : BigInt.zero();
}
