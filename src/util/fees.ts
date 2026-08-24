import { Address, BigInt, ethereum } from "@graphprotocol/graph-ts";
import {
  FeeReceiver,
  FeeReceiverTokenBalance,
} from "../../generated/schema";
import { getOrCreatePaymentToken } from "./metrics";
import { ZERO } from "./constants";

function getOrCreateFeeReceiver(
  receiver: Address,
  event: ethereum.Event,
): FeeReceiver {
  const id = receiver.toHex();
  let feeReceiver = FeeReceiver.load(id);
  if (feeReceiver == null) {
    feeReceiver = new FeeReceiver(id);
    feeReceiver.address = receiver;
    feeReceiver.sweepCount = ZERO;
  }
  feeReceiver.updatedAt = event.block.timestamp;
  feeReceiver.updatedAtBlock = event.block.number;
  return feeReceiver;
}

function getOrCreateBalance(
  feeReceiver: FeeReceiver,
  tokenAddress: Address,
  event: ethereum.Event,
): FeeReceiverTokenBalance {
  const token = getOrCreatePaymentToken(tokenAddress);
  const id = feeReceiver.id + "-" + token.id;

  let balance = FeeReceiverTokenBalance.load(id);
  if (balance == null) {
    balance = new FeeReceiverTokenBalance(id);
    balance.feeReceiver = feeReceiver.id;
    balance.token = token.id;
    balance.accrued = ZERO;
    balance.swept = ZERO;
    balance.balance = ZERO;
  }
  balance.updatedAt = event.block.timestamp;
  balance.updatedAtBlock = event.block.number;
  return balance;
}

// Credits a platform fee that has actually been paid out to `receiver`. Called
// at release / dispute settlement, which is where the processors move the fee
// out of escrow — not at accept or payment, where the receiver is only
// recorded on the invoice.
export function creditFee(
  receiver: Address,
  tokenAddress: Address,
  amount: BigInt,
  event: ethereum.Event,
): void {
  if (amount.le(ZERO) || receiver.equals(Address.zero())) return;

  const feeReceiver = getOrCreateFeeReceiver(receiver, event);
  if (feeReceiver.firstCreditedAt === null) {
    feeReceiver.firstCreditedAt = event.block.timestamp;
  }
  feeReceiver.save();

  const balance = getOrCreateBalance(feeReceiver, tokenAddress, event);
  balance.accrued = balance.accrued.plus(amount);
  balance.balance = balance.balance.plus(amount);
  balance.save();
}

// Debits a fee balance when the Sweeper moves tokens out of the receiver.
export function debitFee(
  receiver: Address,
  tokenAddress: Address,
  amount: BigInt,
  event: ethereum.Event,
): void {
  if (amount.le(ZERO) || receiver.equals(Address.zero())) return;

  const feeReceiver = getOrCreateFeeReceiver(receiver, event);
  feeReceiver.sweepCount = feeReceiver.sweepCount.plus(BigInt.fromI32(1));
  feeReceiver.save();

  const balance = getOrCreateBalance(feeReceiver, tokenAddress, event);
  balance.swept = balance.swept.plus(amount);
  balance.balance = balance.balance.minus(amount);
  balance.save();
}
