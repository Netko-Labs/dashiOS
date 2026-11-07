/**
 * Text Editor's sheets: the question before closing a document with
 * changes, and Find and Replace. Drawn inside the window by the kit's Sheet.
 * Open and Save As are Files' chooser (apps/files/chooser/).
 */

import { Button, Sheet, TextField, useColors } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { useState } from "react";

export type SheetState =
  | { kind: "open" }
  | { kind: "save-as"; after: "close" | null }
  | { kind: "unsaved"; name: string }
  | { kind: "replace" }
  | { kind: "revert"; name: string };

/** Save, Don't Save, or Cancel: Enter saves, Esc cancels. */
export function UnsavedSheet({ name, onSave, onDiscard, onCancel }: { name: string; onSave: () => void; onDiscard: () => void; onCancel: () => void }) {
  const colors = useColors();
  return (
    <Sheet testID="unsaved" width={400} onCancel={onCancel} onConfirm={onSave}>
      <Text style={{ fontSize: 13, fontWeight: "bold", color: colors.text }}>{`Do you want to save the changes you made to “${name}”?`}</Text>
      <Text style={{ fontSize: 12, color: colors.textMuted, lineHeight: 16 }}>Your changes will be lost if you don't save them.</Text>
      <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
        <Button label="Don't Save" testID="unsaved:discard" onPress={onDiscard} />
        <View style={{ flex: 1 }} />
        <Button label="Cancel" testID="unsaved:cancel" onPress={onCancel} />
        <Button label="Save" testID="unsaved:save" primary onPress={onSave} />
      </View>
    </Sheet>
  );
}

export function ReplaceSheet({
  query,
  matches,
  onQuery,
  onReplaceAll,
  onCancel,
}: {
  query: string;
  matches: number;
  onQuery: (query: string) => void;
  /** How many were replaced. */
  onReplaceAll: (replacement: string) => number;
  onCancel: () => void;
}) {
  const colors = useColors();
  const [replacement, setReplacement] = useState("");
  const [done, setDone] = useState<number | null>(null);
  const status =
    done !== null
      ? `Replaced ${done} ${done === 1 ? "match" : "matches"}.`
      : query === ""
        ? " "
        : `${matches === 0 ? "No" : matches} ${matches === 1 ? "match" : "matches"}`;
  const replace = (): void => {
    if (query !== "" && matches > 0) setDone(onReplaceAll(replacement));
  };
  const escape = (key: string): void => {
    if (key === "Escape") onCancel();
  };
  return (
    <Sheet testID="replace" width={400} onCancel={onCancel}>
      <Text style={{ fontSize: 13, fontWeight: "bold", color: colors.text }}>Find and Replace</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View style={{ width: 64 }}>
          <Text style={{ fontSize: 12, color: colors.textMuted, textAlign: "right" }}>Find</Text>
        </View>
        <TextField
          testID="replace:find"
          value={query}
          autoFocus
          onChangeText={(text) => {
            onQuery(text);
            setDone(null);
          }}
          onKeyPress={escape}
        />
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View style={{ width: 64 }}>
          <Text style={{ fontSize: 12, color: colors.textMuted, textAlign: "right" }}>Replace</Text>
        </View>
        <TextField
          testID="replace:with"
          value={replacement}
          onChangeText={(text) => {
            setReplacement(text);
            setDone(null);
          }}
          onSubmit={replace}
          onKeyPress={escape}
        />
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 }}>
        <Text style={{ fontSize: 12, color: colors.textMuted }}>{status}</Text>
        <View style={{ flex: 1 }} />
        <Button label="Done" testID="replace:done" onPress={onCancel} />
        <Button label="Replace All" testID="replace:all" primary disabled={query === "" || matches === 0} onPress={replace} />
      </View>
    </Sheet>
  );
}
