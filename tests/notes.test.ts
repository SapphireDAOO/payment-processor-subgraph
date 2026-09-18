import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import {
  assert,
  beforeEach,
  clearStore,
  describe,
  newMockEvent,
  test,
} from "matchstick-as/assembly/index";
import {
  NoteCreated,
  PublicKeySet,
} from "../generated/Notes/Notes";
import { handleNoteCreated, handlePublicKeySet } from "../src/notes";

const ACCOUNT = "0x00000000000000000000000000000000000000a1";
const KEY = "0x1234abcd";

function publicKeySetEvent(
  account: string,
  key: string,
  version: i32,
  logIndex: i32,
): PublicKeySet {
  const event = changetype<PublicKeySet>(newMockEvent());
  event.logIndex = BigInt.fromI32(logIndex);
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(
    new ethereum.EventParam(
      "account",
      ethereum.Value.fromAddress(Address.fromString(account)),
    ),
  );
  event.parameters.push(
    new ethereum.EventParam(
      "publicKey",
      ethereum.Value.fromBytes(Bytes.fromHexString(key)),
    ),
  );
  event.parameters.push(
    new ethereum.EventParam("version", ethereum.Value.fromI32(version)),
  );
  return event;
}

function noteCreatedEvent(
  invoiceId: i32,
  noteId: i32,
  author: string,
  share: boolean,
): NoteCreated {
  const event = changetype<NoteCreated>(newMockEvent());
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(
    new ethereum.EventParam(
      "invoiceId",
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(invoiceId)),
    ),
  );
  event.parameters.push(
    new ethereum.EventParam(
      "noteId",
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(noteId)),
    ),
  );
  event.parameters.push(
    new ethereum.EventParam(
      "author",
      ethereum.Value.fromAddress(Address.fromString(author)),
    ),
  );
  event.parameters.push(
    new ethereum.EventParam("share", ethereum.Value.fromBoolean(share)),
  );
  event.parameters.push(
    new ethereum.EventParam(
      "encryptedContent",
      ethereum.Value.fromBytes(Bytes.fromHexString("0xdeadbeef")),
    ),
  );
  return event;
}

describe("notes", () => {
  beforeEach(() => {
    clearStore();
  });

  test("registering a key records it with its version", () => {
    handlePublicKeySet(publicKeySetEvent(ACCOUNT, KEY, 1, 0));

    assert.fieldEquals("User", ACCOUNT, "publicKey", KEY);
    assert.fieldEquals("User", ACCOUNT, "publicKeyVersion", "1");
  });

  test("an account that only registered a key is not yet a counted user", () => {
    // Registering is onboarding, not invoice activity: trackUser still owes
    // this account its NewUser point when it first creates or pays an invoice.
    handlePublicKeySet(publicKeySetEvent(ACCOUNT, KEY, 1, 0));

    assert.fieldEquals("User", ACCOUNT, "countedAsNewUser", "false");
    assert.entityCount("User", 1);
  });

  test("the recorded version is the one carried by the event", () => {
    handlePublicKeySet(publicKeySetEvent(ACCOUNT, KEY, 3, 0));

    // Keys keep the version current when they were set, not the latest one.
    assert.fieldEquals("User", ACCOUNT, "publicKeyVersion", "3");
  });

  test("a note is stored against its invoice", () => {
    handleNoteCreated(noteCreatedEvent(7, 2, ACCOUNT, true));

    assert.fieldEquals("Note", "7-2", "invoiceId", "7");
    assert.fieldEquals("Note", "7-2", "noteId", "2");
    assert.fieldEquals("Note", "7-2", "author", ACCOUNT);
    assert.fieldEquals("Note", "7-2", "share", "true");
  });
});
