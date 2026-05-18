import { Address, BigInt } from "@graphprotocol/graph-ts";
import { PaymentProcessorStorage } from "../../generated/AdvancedPaymentProcessor/PaymentProcessorStorage";

const STORAGE_ADDRESS = "0x13676a686fa96408a70acbda6312b330d11ce390";

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
