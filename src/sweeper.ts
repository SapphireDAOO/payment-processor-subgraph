import { Swept as SweptEvent } from "../generated/Sweeper/Sweeper";
import { FeeSweep } from "../generated/schema";
import { getOrCreatePaymentToken } from "./util/metrics";
import { debitFee } from "./util/fees";

export function handleSwept(event: SweptEvent): void {
  // `from` is the fee receiver the Sweeper pulled tokens out of.
  debitFee(event.params.from, event.params.token, event.params.amount, event);

  const token = getOrCreatePaymentToken(event.params.token);

  const sweep = new FeeSweep(
    event.transaction.hash.toHex() + "-" + event.logIndex.toString(),
  );
  sweep.feeReceiver = event.params.from.toHex();
  sweep.token = token.id;
  sweep.destination = event.params.destination;
  sweep.amount = event.params.amount;
  sweep.timestamp = event.block.timestamp;
  sweep.block = event.block.number;
  sweep.txHash = event.transaction.hash;
  sweep.save();
}
