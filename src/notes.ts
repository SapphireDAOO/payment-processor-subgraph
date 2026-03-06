import { BigInt } from "@graphprotocol/graph-ts";
import { NoteCreated, NoteStateChanged } from "../generated/Notes/Notes";
import { Note, NoteOpenState } from "../generated/schema";

function noteEntityId(invoiceId: BigInt, noteId: BigInt): string {
  return invoiceId.toString() + "-" + noteId.toString();
}

function noteOpenStateId(
  invoiceId: BigInt,
  noteId: BigInt,
  user: string
): string {
  return invoiceId.toString() + "-" + noteId.toString() + "-" + user;
}

export function handleNoteCreated(event: NoteCreated): void {
  const id = noteEntityId(event.params.invoiceId, event.params.noteId);

  const note = new Note(id);
  note.invoiceId = event.params.invoiceId;
  note.noteId = event.params.noteId;
  note.author = event.params.author;
  note.share = event.params.share;
  note.encryptedContent = event.params.encryptedContent;
  note.createdAtBlock = event.block.number;
  note.createdAtTx = event.transaction.hash;

  note.save();
}

export function handleNoteStateChanged(event: NoteStateChanged): void {
  const id = noteOpenStateId(
    event.params.invoiceId,
    event.params.noteId,
    event.params.user.toHexString()
  );

  let state = NoteOpenState.load(id);
  if (state == null) {
    state = new NoteOpenState(id);
    state.invoiceId = event.params.invoiceId;
    state.noteId = event.params.noteId;
    state.user = event.params.user;
  }

  state.opened = event.params.opened;
  state.updatedAtBlock = event.block.number;
  state.updatedAtTx = event.transaction.hash;

  state.save();
}
