import { Address, BigInt } from "@graphprotocol/graph-ts";
import { PaymentProcessorStorage } from "../../generated/AdvancedPaymentProcessor/PaymentProcessorStorage";

class Storage {
  constructor(
    public defaultHoldPeriod: BigInt,
    public fee: BigInt
  ) {}
}

const STORAGE_ADDRESS = "0x69238Fa1747f9a90D4D07D7F4712e2819a8308D9";

export function getDefaultHoldPeriod(): Storage {
  let ppStorage = PaymentProcessorStorage.bind(
    Address.fromString(STORAGE_ADDRESS)
  );

  let result = ppStorage.try_getDefaultHoldPeriod();
  if (result.reverted) {
    return new Storage(BigInt.zero(), BigInt.zero());
  }

  return new Storage(result.value, BigInt.zero());
}

export function getFee(amount: BigInt): Storage {
  let ppStorage = PaymentProcessorStorage.bind(
    Address.fromString(STORAGE_ADDRESS)
  );

  let result = ppStorage.try_getFeeRate();
  if (result.reverted) {
    return new Storage(BigInt.zero(), BigInt.zero());
  }

  const feeRate = result.value;

  let denominator = BigInt.fromI32(10_000);

  let fee = denominator.notEqual(BigInt.zero())
    ? amount.times(feeRate).div(denominator)
    : BigInt.zero();

  return new Storage(BigInt.zero(), fee);
}
