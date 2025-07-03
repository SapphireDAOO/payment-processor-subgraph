import { Address } from "@graphprotocol/graph-ts";
import { ERC20 } from "../../generated/AdvancedPaymentProcessor/ERC20";

class TokenData {
  constructor(
    public decimal: string,
    public name: string
  ) {}
}

export function getTokenData(tokenAddress: Address): TokenData {
  let decimal = "0";
  let name = "";

  let token = ERC20.bind(tokenAddress);

  let decimalCall = token.try_decimals();
  if (!decimalCall.reverted) {
    decimal = decimalCall.value.toString();
  }

  let nameCall = token.try_name();

  if (!nameCall.reverted) {
    name = nameCall.value.toString();
  }

  return new TokenData(decimal, name);
}
