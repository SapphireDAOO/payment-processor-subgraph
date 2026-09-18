import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import {
  assert,
  beforeEach,
  clearStore,
  createMockedFunction,
  describe,
  newMockEvent,
  test,
} from "matchstick-as/assembly/index";
import {
  ApprovalAdded,
  SignerAdded,
  SignerRemoved,
  ThresholdUpdated,
  TransactionApproved,
  TransactionCanceled,
  TransactionExecuted,
  TransactionProposed,
} from "../generated/MultiSig/MultiSig";
import {
  handleApprovalAdded,
  handleSignerAdded,
  handleSignerRemoved,
  handleThresholdUpdated,
  handleTransactionApproved,
  handleTransactionCanceled,
  handleTransactionExecuted,
  handleTransactionProposed,
} from "../src/multi-sig";

const WALLET = "0x00000000000000000000000000000000000000f1";
const SIGNER_A = "0x00000000000000000000000000000000000000a1";
const SIGNER_B = "0x00000000000000000000000000000000000000a2";
const TARGET = "0x00000000000000000000000000000000000000d1";
const TX_HASH =
  "0x1111111111111111111111111111111111111111111111111111111111111111";

const SIGNER_A_ID = WALLET + "-" + SIGNER_A;

// The mappings read threshold, signer count and nonce off the wallet on every
// event, so these have to answer for any handler to run.
function mockWalletState(threshold: i32, signers: i32, nonce: i32): void {
  createMockedFunction(
    Address.fromString(WALLET),
    "getThreshold",
    "getThreshold():(uint256)",
  ).returns([ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(threshold))]);
  createMockedFunction(
    Address.fromString(WALLET),
    "getSignerCount",
    "getSignerCount():(uint256)",
  ).returns([ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(signers))]);
  createMockedFunction(
    Address.fromString(WALLET),
    "getNonce",
    "getNonce():(uint256)",
  ).returns([ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(nonce))]);
}

function mockGetTransaction(approvalCount: i32): void {
  const tuple = new ethereum.Tuple();
  tuple.push(ethereum.Value.fromAddress(Address.fromString(TARGET)));
  tuple.push(ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(5)));
  tuple.push(ethereum.Value.fromBytes(Bytes.fromHexString("0xabcd")));
  tuple.push(ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1)));
  tuple.push(ethereum.Value.fromI32(0));
  tuple.push(
    ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(approvalCount)),
  );

  createMockedFunction(
    Address.fromString(WALLET),
    "getTransaction",
    "getTransaction(bytes32):((address,uint256,bytes,uint256,uint8,uint256))",
  )
    .withArgs([
      ethereum.Value.fromFixedBytes(Bytes.fromHexString(TX_HASH)),
    ])
    .returns([ethereum.Value.fromTuple(tuple)]);
}

function walletEvent(): ethereum.Event {
  const event = newMockEvent();
  event.address = Address.fromString(WALLET);
  return event;
}

function signerAddedEvent(signer: string): SignerAdded {
  const event = changetype<SignerAdded>(walletEvent());
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(
    new ethereum.EventParam(
      "signer",
      ethereum.Value.fromAddress(Address.fromString(signer)),
    ),
  );
  return event;
}

function signerRemovedEvent(signer: string): SignerRemoved {
  const event = changetype<SignerRemoved>(walletEvent());
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(
    new ethereum.EventParam(
      "signer",
      ethereum.Value.fromAddress(Address.fromString(signer)),
    ),
  );
  return event;
}

function thresholdUpdatedEvent(oldT: i32, newT: i32): ThresholdUpdated {
  const event = changetype<ThresholdUpdated>(walletEvent());
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(
    new ethereum.EventParam(
      "oldThreshold",
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(oldT)),
    ),
  );
  event.parameters.push(
    new ethereum.EventParam(
      "newThreshold",
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(newT)),
    ),
  );
  return event;
}

function proposedEvent(): TransactionProposed {
  const event = changetype<TransactionProposed>(walletEvent());
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(
    new ethereum.EventParam(
      "txHash",
      ethereum.Value.fromFixedBytes(Bytes.fromHexString(TX_HASH)),
    ),
  );
  event.parameters.push(
    new ethereum.EventParam(
      "target",
      ethereum.Value.fromAddress(Address.fromString(TARGET)),
    ),
  );
  event.parameters.push(
    new ethereum.EventParam(
      "value",
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(5)),
    ),
  );
  event.parameters.push(
    new ethereum.EventParam(
      "data",
      ethereum.Value.fromBytes(Bytes.fromHexString("0xabcd")),
    ),
  );
  event.parameters.push(
    new ethereum.EventParam(
      "nonce",
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1)),
    ),
  );
  event.parameters.push(
    new ethereum.EventParam(
      "proposer",
      ethereum.Value.fromAddress(Address.fromString(SIGNER_A)),
    ),
  );
  return event;
}

function approvalAddedEvent(approver: string, count: i32): ApprovalAdded {
  const event = changetype<ApprovalAdded>(walletEvent());
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(
    new ethereum.EventParam(
      "txHash",
      ethereum.Value.fromFixedBytes(Bytes.fromHexString(TX_HASH)),
    ),
  );
  event.parameters.push(
    new ethereum.EventParam(
      "approver",
      ethereum.Value.fromAddress(Address.fromString(approver)),
    ),
  );
  event.parameters.push(
    new ethereum.EventParam(
      "approvalCount",
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(count)),
    ),
  );
  return event;
}

function txHashOnlyEvent<T>(): ethereum.Event {
  const event = walletEvent();
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(
    new ethereum.EventParam(
      "txHash",
      ethereum.Value.fromFixedBytes(Bytes.fromHexString(TX_HASH)),
    ),
  );
  return event;
}

function approvedEvent(): TransactionApproved {
  return changetype<TransactionApproved>(txHashOnlyEvent<TransactionApproved>());
}

function canceledEvent(): TransactionCanceled {
  return changetype<TransactionCanceled>(txHashOnlyEvent<TransactionCanceled>());
}

function executedEvent(executor: string): TransactionExecuted {
  const event = changetype<TransactionExecuted>(walletEvent());
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(
    new ethereum.EventParam(
      "txHash",
      ethereum.Value.fromFixedBytes(Bytes.fromHexString(TX_HASH)),
    ),
  );
  event.parameters.push(
    new ethereum.EventParam(
      "executor",
      ethereum.Value.fromAddress(Address.fromString(executor)),
    ),
  );
  return event;
}

describe("multisig", () => {
  beforeEach(() => {
    clearStore();
    mockWalletState(2, 3, 1);
    mockGetTransaction(0);
  });

  test("adding a signer creates the wallet and syncs its state", () => {
    handleSignerAdded(signerAddedEvent(SIGNER_A));

    assert.fieldEquals("MultiSigWallet", WALLET, "threshold", "2");
    assert.fieldEquals("MultiSigWallet", WALLET, "signerCount", "3");
    assert.fieldEquals("MultiSigWallet", WALLET, "transactionCount", "1");
    assert.fieldEquals("MultiSigSigner", SIGNER_A_ID, "active", "true");
    assert.fieldEquals("MultiSigSigner", SIGNER_A_ID, "address", SIGNER_A);
  });

  test("removing a signer deactivates it without deleting it", () => {
    handleSignerAdded(signerAddedEvent(SIGNER_A));
    handleSignerRemoved(signerRemovedEvent(SIGNER_A));

    assert.fieldEquals("MultiSigSigner", SIGNER_A_ID, "active", "false");
    assert.entityCount("MultiSigSigner", 1);
  });

  test("re-adding a removed signer clears its removal", () => {
    handleSignerAdded(signerAddedEvent(SIGNER_A));
    handleSignerRemoved(signerRemovedEvent(SIGNER_A));
    handleSignerAdded(signerAddedEvent(SIGNER_A));

    assert.fieldEquals("MultiSigSigner", SIGNER_A_ID, "active", "true");
    assert.fieldEquals("MultiSigSigner", SIGNER_A_ID, "removedAt", "null");
  });

  test("a threshold update is taken from the event", () => {
    handleThresholdUpdated(thresholdUpdatedEvent(2, 3));

    assert.fieldEquals("MultiSigWallet", WALLET, "threshold", "3");
  });

  test("a proposed transaction starts out PROPOSED", () => {
    handleTransactionProposed(proposedEvent());

    assert.fieldEquals("MultiSigTransaction", TX_HASH, "status", "PROPOSED");
    assert.fieldEquals("MultiSigTransaction", TX_HASH, "target", TARGET);
    assert.fieldEquals("MultiSigTransaction", TX_HASH, "proposer", SIGNER_A);
    assert.fieldEquals("MultiSigTransaction", TX_HASH, "nonce", "1");
  });

  test("an approval is linked back to its signer", () => {
    handleSignerAdded(signerAddedEvent(SIGNER_A));
    handleTransactionProposed(proposedEvent());
    handleApprovalAdded(approvalAddedEvent(SIGNER_A, 1));

    const approvalId = TX_HASH + "-" + SIGNER_A;
    assert.fieldEquals("MultiSigApproval", approvalId, "approver", SIGNER_A);
    assert.fieldEquals("MultiSigApproval", approvalId, "signer", SIGNER_A_ID);
    assert.fieldEquals("MultiSigTransaction", TX_HASH, "approvalCount", "1");
  });

  test("an approval from a non-signer is still recorded, without a signer", () => {
    handleTransactionProposed(proposedEvent());
    handleApprovalAdded(approvalAddedEvent(SIGNER_B, 1));

    const approvalId = TX_HASH + "-" + SIGNER_B;
    assert.fieldEquals("MultiSigApproval", approvalId, "approver", SIGNER_B);
    assert.fieldEquals("MultiSigApproval", approvalId, "signer", "null");
  });

  test("approval and execution move the transaction through its states", () => {
    handleTransactionProposed(proposedEvent());
    handleTransactionApproved(approvedEvent());
    assert.fieldEquals("MultiSigTransaction", TX_HASH, "status", "APPROVED");

    handleTransactionExecuted(executedEvent(SIGNER_A));
    assert.fieldEquals("MultiSigTransaction", TX_HASH, "status", "EXECUTED");
    assert.fieldEquals("MultiSigTransaction", TX_HASH, "executor", SIGNER_A);
  });

  test("cancelling marks the transaction CANCELED", () => {
    handleTransactionProposed(proposedEvent());
    handleTransactionCanceled(canceledEvent());

    assert.fieldEquals("MultiSigTransaction", TX_HASH, "status", "CANCELED");
  });

  test("events for an unknown transaction are ignored", () => {
    handleTransactionApproved(approvedEvent());
    handleApprovalAdded(approvalAddedEvent(SIGNER_A, 1));

    assert.entityCount("MultiSigTransaction", 0);
    assert.entityCount("MultiSigApproval", 0);
  });
});
