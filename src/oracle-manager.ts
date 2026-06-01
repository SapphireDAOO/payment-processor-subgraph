import { PriceFeedSet } from "../generated/OracleManager/OracleManager";
import { PaymentToken } from "../generated/schema";
import { getTokenData } from "./util/token";

export function handlePriceFeedSet(event: PriceFeedSet): void {
  const id = event.params.token.toHex();
  if (PaymentToken.load(id) != null) return;

  const data = getTokenData(event.params.token);
  const token = new PaymentToken(id);
  token.name = data.name;
  token.decimal = data.decimal;
  token.save();
}
