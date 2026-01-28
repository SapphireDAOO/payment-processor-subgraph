import { BigInt } from "@graphprotocol/graph-ts";
import { NoteCreated, NoteStateChanged } from "../generated/Notes/Notes";
import { Note, NoteOpenState } from "../generated/schema";

function noteEntityId(orderId: BigInt, noteId: BigInt): string {
  return orderId.toString() + "-" + noteId.toString();
}

function noteOpenStateId(
  orderId: BigInt,
  noteId: BigInt,
  user: string
): string {
  return orderId.toString() + "-" + noteId.toString() + "-" + user;
}

export function handleNoteCreated(event: NoteCreated): void {
  let id = noteEntityId(event.params.orderId, event.params.noteId);

  let note = new Note(id);
  note.orderId = event.params.orderId;
  note.noteId = event.params.noteId;
  note.author = event.params.author;
  note.share = event.params.share;
  note.encryptedContent = event.params.encryptedContent;
  note.createdAtBlock = event.block.number;
  note.createdAtTx = event.transaction.hash;

  note.save();
}

export function handleNoteStateChanged(event: NoteStateChanged): void {
  let id = noteOpenStateId(
    event.params.orderId,
    event.params.noteId,
    event.params.user.toHexString()
  );

  let state = NoteOpenState.load(id);
  if (state == null) {
    state = new NoteOpenState(id);
    state.orderId = event.params.orderId;
    state.noteId = event.params.noteId;
    state.user = event.params.user;
  }

  state.opened = event.params.opened;
  state.updatedAtBlock = event.block.number;
  state.updatedAtTx = event.transaction.hash;

  state.save();
}
