import { Address, Bytes } from "@graphprotocol/graph-ts";
import {
  MultiSig,
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
  MultiSigApproval,
  MultiSigSigner,
  MultiSigTransaction,
  MultiSigWallet,
} from "../generated/schema";
import {
  STATUS_APPROVED,
  STATUS_CANCELED,
  STATUS_EXECUTED,
  STATUS_PROPOSED,
  ZERO,
} from "./util/constants";

function getWalletId(address: Address): string {
  return address.toHexString();
}

function getSignerId(walletAddress: Address, signer: Address): string {
  return getWalletId(walletAddress) + "-" + signer.toHexString();
}

function getApprovalId(txHash: Bytes, approver: Address): string {
  return txHash.toHexString() + "-" + approver.toHexString();
}

function syncWalletState(wallet: MultiSigWallet, contract: MultiSig): void {
  let thresholdResult = contract.try_getThreshold();
  if (!thresholdResult.reverted) {
    wallet.threshold = thresholdResult.value;
  }

  let signerCountResult = contract.try_getSignerCount();
  if (!signerCountResult.reverted) {
    wallet.signerCount = signerCountResult.value;
  }

  let nonceResult = contract.try_getNonce();
  if (!nonceResult.reverted) {
    wallet.transactionCount = nonceResult.value;
  }
}

function getOrCreateWallet(address: Address): MultiSigWallet {
  let walletId = getWalletId(address);
  let wallet = MultiSigWallet.load(walletId);
  if (wallet == null) {
    wallet = new MultiSigWallet(walletId);
    wallet.threshold = ZERO;
    wallet.signerCount = ZERO;
    wallet.transactionCount = ZERO;
  }

  syncWalletState(wallet, MultiSig.bind(address));
  return wallet;
}

export function handleSignerAdded(event: SignerAdded): void {
  let wallet = getOrCreateWallet(event.address);

  let signerId = getSignerId(event.address, event.params.signer);
  let signer = MultiSigSigner.load(signerId);
  if (signer == null) {
    signer = new MultiSigSigner(signerId);
    signer.wallet = wallet.id;
    signer.address = event.params.signer;
  }
  signer.addedAt = event.block.timestamp;
  signer.active = true;
  signer.removedAt = null;
  signer.save();

  wallet.save();
}

export function handleSignerRemoved(event: SignerRemoved): void {
  let wallet = getOrCreateWallet(event.address);

  let signerId = getSignerId(event.address, event.params.signer);
  let signer = MultiSigSigner.load(signerId);
  if (signer != null) {
    signer.active = false;
    signer.removedAt = event.block.timestamp;
    signer.save();
  }

  wallet.save();
}

export function handleThresholdUpdated(event: ThresholdUpdated): void {
  let wallet = getOrCreateWallet(event.address);
  wallet.threshold = event.params.newThreshold;
  wallet.save();
}

export function handleTransactionProposed(event: TransactionProposed): void {
  let wallet = getOrCreateWallet(event.address);

  let tx = MultiSigTransaction.load(event.params.txHash);
  if (tx == null) {
    tx = new MultiSigTransaction(event.params.txHash);
    tx.proposedAt = event.block.timestamp;
  }
  tx.wallet = wallet.id;
  tx.target = event.params.target;
  tx.value = event.params.value;
  tx.data = event.params.data;
  tx.nonce = event.params.nonce;
  tx.proposer = event.params.proposer;
  tx.status = STATUS_PROPOSED;
  tx.approvalCount = ZERO;

  let contract = MultiSig.bind(event.address);
  let onChainTransaction = contract.try_getTransaction(event.params.txHash);
  if (!onChainTransaction.reverted) {
    tx.target = onChainTransaction.value.target;
    tx.value = onChainTransaction.value.value;
    tx.data = onChainTransaction.value.data;
    tx.nonce = onChainTransaction.value.nonce;
    tx.approvalCount = onChainTransaction.value.approvalCount;
  }

  tx.save();
  wallet.save();
}

export function handleApprovalAdded(event: ApprovalAdded): void {
  let tx = MultiSigTransaction.load(event.params.txHash);
  if (tx == null) return;

  tx.approvalCount = event.params.approvalCount;
  tx.save();

  let approvalId = getApprovalId(event.params.txHash, event.params.approver);
  let approval = MultiSigApproval.load(approvalId);
  if (approval == null) {
    approval = new MultiSigApproval(approvalId);
    approval.transaction = tx.id;
    approval.approver = event.params.approver;
    approval.approvedAt = event.block.timestamp;
  }

  let signer = MultiSigSigner.load(
    getSignerId(event.address, event.params.approver),
  );
  approval.signer = signer != null ? signer.id : null;
  approval.approvalCount = event.params.approvalCount;
  approval.save();
}

export function handleTransactionApproved(event: TransactionApproved): void {
  let tx = MultiSigTransaction.load(event.params.txHash);
  if (tx == null) return;
  tx.status = STATUS_APPROVED;
  tx.save();
}

export function handleTransactionExecuted(event: TransactionExecuted): void {
  let tx = MultiSigTransaction.load(event.params.txHash);
  if (tx == null) return;

  let contract = MultiSig.bind(event.address);
  let onChainTransaction = contract.try_getTransaction(event.params.txHash);
  if (!onChainTransaction.reverted) {
    tx.approvalCount = onChainTransaction.value.approvalCount;
  }

  tx.status = STATUS_EXECUTED;
  tx.executor = event.params.executor;
  tx.executedAt = event.block.timestamp;
  tx.save();
}

export function handleTransactionCanceled(event: TransactionCanceled): void {
  let tx = MultiSigTransaction.load(event.params.txHash);
  if (tx == null) return;

  tx.status = STATUS_CANCELED;
  tx.save();
}
