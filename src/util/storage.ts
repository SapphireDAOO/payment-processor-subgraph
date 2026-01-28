import { Address, BigInt } from "@graphprotocol/graph-ts";
import { PaymentProcessorStorage } from "../../generated/AdvancedPaymentProcessor/PaymentProcessorStorage";

class Storage {
  constructor(
    public defaultHoldPeriod: BigInt,
    public fee: BigInt
  ) {}
}

const STORAGE_ADDRESS = "0xeb57F1F77F873d8481510c1f5Ee44dE340Dc93fe";

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
