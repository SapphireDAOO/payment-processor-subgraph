import { Address } from "@graphprotocol/graph-ts";
import { ERC20 } from "../../generated/AdvancedPaymentProcessor/ERC20";

class TokenData {
  constructor(
    public decimal: i32,
    public name: string
  ) {}
}

export function getTokenData(tokenAddress: Address): TokenData {
  if (tokenAddress.equals(Address.zero())) {
    return new TokenData(18, "ETH");
  }

  let decimal = 0;
  let name = "";

  let token = ERC20.bind(tokenAddress);

  let decimalCall = token.try_decimals();
  if (!decimalCall.reverted) {
    decimal = decimalCall.value;
  }

  let nameCall = token.try_name();

  if (!nameCall.reverted) {
    name = nameCall.value.toString();
  }

  return new TokenData(decimal, name);
}
