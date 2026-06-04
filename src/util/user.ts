import { Address, BigInt } from "@graphprotocol/graph-ts";
import { User } from "../../generated/schema";
import { recordActiveUser, recordNewUser } from "./metrics";
import { SECONDS_PER_DAY } from "./constants";

export function trackUser(
  address: Address,
  role: string,
  timestamp: BigInt,
): User {
  const id = address.toHex();
  let user = User.load(id);

  if (user == null) {
    user = new User(id);
    user.save();
    recordNewUser(address, role);
  }

  const day = timestamp.div(SECONDS_PER_DAY);
  const last = user.lastActiveDay;
  if (last === null || last.notEqual(day)) {
    user.lastActiveDay = day;
    user.save();
    recordActiveUser(address, role);
  }

  return user;
}
