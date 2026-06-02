import { Address, BigInt, ethereum } from "@graphprotocol/graph-ts";
import {
  GasPaid,
  MetricData,
  PaymentToken,
  RecentTransaction,
  TokenMetric,
} from "../../generated/schema";
import { getTokenData } from "./token";

const GLOBAL = "global";
const ZERO = BigInt.fromI32(0);
const ONE = BigInt.fromI32(1);
const ONE_DAY = BigInt.fromI32(86400); // seconds

export const SIMPLE = "SIMPLE";
export const ADVANCED = "ADVANCED";

function clampZero(value: BigInt): BigInt {
  return value.lt(ZERO) ? ZERO : value;
}

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

export function getOrCreateMetricData(): MetricData {
  let metric = MetricData.load(GLOBAL);
  if (metric) return metric;

  metric = new MetricData(GLOBAL);
  metric.paidInvoices = ZERO;
  metric.lastPaidInvoiceTimestamp = ZERO;
  metric.simpleTransactionCount = ZERO;
  metric.advancedTransactionCount = ZERO;
  metric.transactionCountLastUpdate = ZERO;
  metric.newUsers = ZERO;
  metric.activeUsers = ZERO;
  metric.activeUsersLastUpdate = ZERO;
  metric.save();

  return metric;
}

function getOrCreateTokenMetric(tokenAddress: Address): TokenMetric {
  const token = getOrCreatePaymentToken(tokenAddress);

  let tokenMetric = TokenMetric.load(token.id);
  if (tokenMetric) return tokenMetric;

  tokenMetric = new TokenMetric(token.id);
  tokenMetric.metric = getOrCreateMetricData().id;
  tokenMetric.token = token.id;
  tokenMetric.volumeBalance = ZERO;
  tokenMetric.escrowBalance = ZERO;
  tokenMetric.feeBalance = ZERO;
  tokenMetric.save();

  return tokenMetric;
}

// Invoice Paid: cumulative volume and live escrow both grow by the amount paid;
// the currently-paid (unsettled) counter increments.
export function recordPayment(
  tokenAddress: Address,
  amount: BigInt,
  timestamp: BigInt
): void {
  const tokenMetric = getOrCreateTokenMetric(tokenAddress);
  tokenMetric.volumeBalance = tokenMetric.volumeBalance.plus(amount);
  tokenMetric.escrowBalance = tokenMetric.escrowBalance.plus(amount);
  tokenMetric.save();

  const metric = getOrCreateMetricData();
  metric.paidInvoices = metric.paidInvoices.plus(ONE);
  metric.lastPaidInvoiceTimestamp = timestamp;
  metric.save();
}

// Settlement (Refund / Dispute settled / Release): escrow shrinks by the amount
// leaving escrow. paidInvoices only decrements when the invoice was still
// counted as paid (decrementPaid), so partial refunds don't double-count.
export function recordSettlement(
  tokenAddress: Address,
  escrowAmount: BigInt,
  decrementPaid: boolean,
  timestamp: BigInt
): void {
  const tokenMetric = getOrCreateTokenMetric(tokenAddress);
  tokenMetric.escrowBalance = clampZero(
    tokenMetric.escrowBalance.minus(escrowAmount)
  );
  tokenMetric.save();

  const metric = getOrCreateMetricData();
  if (decrementPaid) {
    metric.paidInvoices = clampZero(metric.paidInvoices.minus(ONE));
  }
  metric.lastPaidInvoiceTimestamp = timestamp;
  metric.save();
}

// Cumulative protocol fees per token (raw token units). Fees are never reversed.
export function recordFee(tokenAddress: Address, fee: BigInt): void {
  const tokenMetric = getOrCreateTokenMetric(tokenAddress);
  tokenMetric.feeBalance = tokenMetric.feeBalance.plus(fee);
  tokenMetric.save();
}

// Invoice Activity: per-processor daily counter. Resets to 1 when more than 24h
// have elapsed since the last counted event (shared timestamp, per the spec).
export function recordActivity(processor: string, timestamp: BigInt): void {
  const metric = getOrCreateMetricData();
  const reset = timestamp.minus(metric.transactionCountLastUpdate).gt(ONE_DAY);

  if (processor == SIMPLE) {
    metric.simpleTransactionCount = reset
      ? ONE
      : metric.simpleTransactionCount.plus(ONE);
  } else {
    metric.advancedTransactionCount = reset
      ? ONE
      : metric.advancedTransactionCount.plus(ONE);
  }

  metric.transactionCountLastUpdate = timestamp;
  metric.save();
}

// Called when a brand-new User entity is created.
export function recordNewUser(): void {
  const metric = getOrCreateMetricData();
  metric.newUsers = metric.newUsers.plus(ONE);
  metric.save();
}

// Active Users: counter that resets every 24h. NOTE: this counts activity events
// in the window, not unique addresses — true uniqueness needs a per-user
// lastActive field on the User entity.
export function recordActiveUser(timestamp: BigInt): void {
  const metric = getOrCreateMetricData();
  if (timestamp.minus(metric.activeUsersLastUpdate).gt(ONE_DAY)) {
    metric.activeUsers = ONE;
  } else {
    metric.activeUsers = metric.activeUsers.plus(ONE);
  }
  metric.activeUsersLastUpdate = timestamp;
  metric.save();
}

// Gas Tracker: cumulative gas spent on platform-initiated actions. Gas cost is
// approximated as gasLimit * gasPrice (gasUsed is only available with receipts).
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

// Append-only recent transaction. amount is signed: positive on Paid, negative
// on Release. Query first: 5, orderBy timestamp desc.
export function addRecentTransaction(
  event: ethereum.Event,
  amount: BigInt,
  tokenAddress: Address
): void {
  const id =
    event.transaction.hash.toHex() + "-" + event.logIndex.toString();
  const recent = new RecentTransaction(id);
  recent.transactionHash = event.transaction.hash;
  recent.timestamp = event.block.timestamp;
  recent.amount = amount;
  recent.token = getOrCreatePaymentToken(tokenAddress).id;
  recent.save();
}
