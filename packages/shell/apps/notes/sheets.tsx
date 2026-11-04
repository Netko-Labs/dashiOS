/** Notes' sheets: a name for a folder, and the questions that can't be taken back. */

import { Button, ConfirmSheet, Sheet, TextField, useColors } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { useState } from "react";

export type SheetState =
  | { kind: "new-folder" }
  | { kind: "rename-folder"; name: string }
  | { kind: "delete-folder"; name: string; count: number }
  | { kind: "purge"; title: string }
  | { kind: "empty-trash"; count: number };

function NameSheet({
  title,
  message,
  initial,
  confirmLabel,
  onSubmit,
  onCancel,
}: {
  title: string;
  message: string;
  initial: string;
  confirmLabel: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const colors = useColors();
  const [name, setName] = useState(initial);
  const submit = (): void => {
    if (name.trim() !== "") onSubmit(name);
  };
  return (
    <Sheet testID="name-sheet" width={340}>
      <Text style={{ fontSize: 13, fontWeight: "bold", color: colors.text }}>{title}</Text>
      <Text style={{ fontSize: 12, color: colors.textMuted }}>{message}</Text>
      <TextField testID="name-field" value={name} onChangeText={setName} autoFocus onSubmit={submit} onKeyPress={(key) => key === "Escape" && onCancel()} />
      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
        <Button label="Cancel" testID="name-sheet:cancel" onPress={onCancel} />
        <Button label={confirmLabel} testID="name-sheet:ok" primary onPress={submit} />
      </View>
    </Sheet>
  );
}

export function NotesSheet({
  sheet,
  onClose,
  actions,
}: {
  sheet: SheetState;
  onClose: () => void;
  actions: {
    createFolder(name: string): void;
    renameFolder(from: string, to: string): void;
    deleteFolder(name: string): void;
    purge(): void;
    emptyTrash(): void;
  };
}) {
  const done = (action: () => void) => () => {
    action();
    onClose();
  };
  switch (sheet.kind) {
    case "new-folder":
      return (
        <NameSheet
          title="New Folder"
          message="Name this folder."
          initial=""
          confirmLabel="Create"
          onCancel={onClose}
          onSubmit={(name) => done(() => actions.createFolder(name))()}
        />
      );
    case "rename-folder":
      return (
        <NameSheet
          title="Rename Folder"
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
          message={
            sheet.count === 0
              ? "The folder is empty."
              : `Its ${sheet.count === 1 ? "note moves" : `${sheet.count} notes move`} to Recently Deleted, where ${sheet.count === 1 ? "it stays" : "they stay"} for 30 days.`
          }
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
          title={`Delete “${sheet.title || "New Note"}” forever?`}
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
          message={`${sheet.count === 1 ? "1 note" : `${sheet.count} notes`} will be deleted forever. This can't be undone.`}
          confirmLabel="Delete All"
          danger
          onConfirm={done(actions.emptyTrash)}
          onCancel={onClose}
        />
      );
  }
}
