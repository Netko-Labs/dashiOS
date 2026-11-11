/**
 * Renaming in place (F2, Rename…, a new folder): the item's name becomes a
 * field with the name selected up to its extension, so typing replaces the
 * name and keeps ".pdf". Return renames, Esc keeps the name, and a click
 * elsewhere renames to what was typed (store.ts `commitRename`). ❖A, ❖C,
 * ❖X, ❖V and ❖Z are the field's while it has the keyboard (KB-6).
 */

import { useColors, useSurface } from "@dashi/ui";
import { TextInput } from "@mirinjs/metal";
import { useState } from "react";
import { type FileItem, splitName } from "../../../files/index.ts";
import { useFiles } from "../../context.ts";

/** What the field selects when it opens: the stem, so the extension stays (a folder's whole name). */
export function stemSelection(item: Pick<FileItem, "name" | "kind">): { start: number; end: number } {
  return { start: 0, end: item.kind === "folder" ? item.name.length : splitName(item.name).stem.length };
}

export function RenameField({ item, width }: { item: FileItem; width?: number }) {
  const colors = useColors();
  const surface = useSurface();
  const { store, actions } = useFiles();
  const [text, setText] = useState(item.name);
  const [selection] = useState(() => stemSelection(item));
  return (
    <TextInput
      testID={`rename:${item.path}`}
      value={text}
      autoFocus
      selection={selection}
      onChangeText={(next) => {
        setText(next);
        store.draftRename(next);
      }}
      onSubmitEditing={(typed) =>
        void store.commitRename(typed).then((done) => {
          if (done) actions.refocus();
        })
      }
      onKeyPress={(key) => {
        if (key !== "Escape") return;
        store.endRename();
        actions.refocus();
      }}
      accessibilityLabel={`Rename “${item.name}”`}
      style={{
        ...(width !== undefined ? { width } : { flex: 1 }),
        height: 20,
        padding: 2,
        fontSize: 12,
        borderRadius: 4,
        color: colors.text,
        backgroundColor: surface.card,
        borderColor: colors.selection,
        focusBorderColor: colors.selection,
      }}
    />
  );
}
