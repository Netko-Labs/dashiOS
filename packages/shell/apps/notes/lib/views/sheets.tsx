/**
 * Notes' sheets: a name for a folder, and the questions that can't be taken
 * back. All of them are the one alert frame (UI-5): the glyph's tile, the
 * question, the message, then the name field when there is one, and the
 * buttons, so a name and a confirmation share their width, title and insets.
 */

import { AlertSheet, ConfirmSheet, TextField } from "@dashi/ui";
import { useState } from "react";
import { untitled } from "../../../../src/shared/notes/index.ts";
import { FOLDER, FOLDER_PLUS } from "../glyphs.ts";

export type SheetState =
  | { kind: "new-folder" }
  | { kind: "rename-folder"; name: string }
  | { kind: "delete-folder"; name: string; count: number }
  | { kind: "purge"; title: string }
  | { kind: "empty-trash"; count: number };

function NameSheet({
  title,
  message,
  glyph,
  initial,
  confirmLabel,
  onSubmit,
  onCancel,
}: {
  title: string;
  message?: string;
  glyph: string;
  initial: string;
  confirmLabel: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial);
  const submit = (): void => {
    if (name.trim() !== "") onSubmit(name);
  };
  return (
    <AlertSheet
      testID="name-sheet"
      question={title}
      {...(message !== undefined ? { message } : {})}
      glyph={glyph}
      buttons={[
        { label: "Cancel", testID: "name-sheet:cancel", onPress: onCancel, cancel: true },
        { label: confirmLabel, testID: "name-sheet:ok", onPress: submit, kind: "primary", disabled: name.trim() === "" },
      ]}
    >
      <TextField testID="name-field" value={name} onChangeText={setName} autoFocus onSubmit={submit} onKeyPress={(key) => key === "Escape" && onCancel()} />
    </AlertSheet>
  );
}

interface SheetActions {
  createFolder(name: string): void;
  renameFolder(from: string, to: string): void;
  deleteFolder(name: string): void;
  purge(): void;
  emptyTrash(): void;
}

/** What becomes of a deleted folder's notes. */
function whereNotesGo(count: number): string {
  if (count === 0) return "The folder is empty.";
  return `Its ${count === 1 ? "note moves" : `${count} notes move`} to Recently Deleted, where ${count === 1 ? "it stays" : "they stay"} for 30 days.`;
}

export function NotesSheet({ sheet, onClose, actions }: { sheet: SheetState; onClose: () => void; actions: SheetActions }) {
  const done = (action: () => void) => () => {
    action();
    onClose();
  };
  switch (sheet.kind) {
    case "new-folder":
      return (
        <NameSheet
          title="New folder"
          glyph={FOLDER_PLUS}
          initial=""
          confirmLabel="Create"
          onCancel={onClose}
          onSubmit={(name) => done(() => actions.createFolder(name))()}
        />
      );
    case "rename-folder":
      return (
        <NameSheet
          title="Rename folder"
          glyph={FOLDER}
          message={`Enter a new name for “${sheet.name}”.`}
          initial={sheet.name}
          confirmLabel="Rename"
          onCancel={onClose}
          onSubmit={(name) => done(() => actions.renameFolder(sheet.name, name))()}
        />
      );
    case "delete-folder":
      return (
        <ConfirmSheet
          testID="delete-folder"
          title={`Delete the folder “${sheet.name}”?`}
          message={whereNotesGo(sheet.count)}
          confirmLabel="Delete"
          danger
          onConfirm={done(() => actions.deleteFolder(sheet.name))}
          onCancel={onClose}
        />
      );
    case "purge":
      return (
        <ConfirmSheet
          testID="purge"
          title={`Delete “${untitled(sheet.title)}” forever?`}
          message="This note can't be restored afterwards."
          confirmLabel="Delete Forever"
          danger
          onConfirm={done(actions.purge)}
          onCancel={onClose}
        />
      );
    case "empty-trash":
      return (
        <ConfirmSheet
          testID="empty-trash"
          title="Delete everything in Recently Deleted?"
          message={`${sheet.count === 1 ? "1 note" : `${sheet.count} notes`} will be deleted forever.`}
          confirmLabel="Delete All"
          danger
          onConfirm={done(actions.emptyTrash)}
          onCancel={onClose}
        />
      );
  }
}
