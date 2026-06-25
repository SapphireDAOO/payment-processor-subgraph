import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import {
  ActiveUser,
  EscrowBalance,
  FeePaid,
  GasPaid,
  InvoiceActivity,
  NewUser,
  PaymentToken,
  PaymentVolume,
} from "../../generated/schema";
import { getTokenData } from "./token";
import { GLOBAL, ONE, TS_ID, ZERO } from "./constants";

export function getOrCreatePaymentToken(tokenAddress: Address): PaymentToken {
  const id = tokenAddress.toHex();
  let token = PaymentToken.load(id);
  if (token) return token;

  const data = getTokenData(tokenAddress);
  token = new PaymentToken(id);
  token.name = data.name;
  token.decimal = data.decimal;
  token.save();

  return token;
}

export function recordPaymentVolume(
  tokenAddress: Address,
  amount: BigInt,
): void {
  const token = getOrCreatePaymentToken(tokenAddress);

  const point = new PaymentVolume(TS_ID);
  point.token = token.id;
  point.amount = amount;
  point.save();
}

export function recordEscrowDelta(tokenAddress: Address, delta: BigInt): void {
  if (delta.isZero()) return;

  const token = getOrCreatePaymentToken(tokenAddress);

  const point = new EscrowBalance(TS_ID);
  point.token = token.id;
  // Signed delta: summed into totalBalance to give the net escrow balance.
  point.balance = delta;
  // Only inbound deposits count as amount paid; withdrawals contribute zero so
  // totalAmountPaid reflects the gross amount ever paid in.
  point.amountPaid = delta.gt(ZERO) ? delta : ZERO;
  point.save();
}

export function recordFee(
  tokenAddress: Address,
  fee: BigInt,
  txHash: Bytes,
): void {
  if (fee.isZero()) return;

  const token = getOrCreatePaymentToken(tokenAddress);

  const point = new FeePaid(TS_ID);
  point.token = token.id;
  point.amount = fee;
  point.txHash = txHash;
  point.save();
}

export function recordInvoiceActivity(invoiceType: string): void {
  const point = new InvoiceActivity(TS_ID);
  point.invoiceType = invoiceType;
  point.save();
}

export function recordNewUser(user: Address, role: string): void {
  const point = new NewUser(TS_ID);
  point.user = user;
  point.role = role;
  point.save();
}

export function recordActiveUser(user: Address, role: string): void {
  const point = new ActiveUser(TS_ID);
  point.user = user;
  point.role = role;
  point.save();
}

export function recordGas(event: ethereum.Event): void {
  let gas = GasPaid.load(GLOBAL);
  if (gas == null) {
    gas = new GasPaid(GLOBAL);
    gas.amount = ZERO;
    gas.transactionCount = ZERO;
    gas.lastTimeStamp = ZERO;
  }

  const cost = event.transaction.gasPrice.times(event.transaction.gasLimit);
  gas.amount = gas.amount.plus(cost);
  gas.transactionCount = gas.transactionCount.plus(ONE);
  gas.lastTimeStamp = event.block.timestamp;
  gas.save();
}
