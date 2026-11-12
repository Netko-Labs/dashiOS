/**
 * Text Editor's sheets: Revert To… (the file's earlier versions,
 * versions.ts), the question when the file changed on disk meanwhile, Go to
 * Line, and Find and Replace. Drawn inside the window by the kit's Sheet; the
 * questions in the one alert frame (UI-5). Open and Save As are Files'
 * chooser (src/shared/file-browser/).
 */

import { AlertSheet, Button, RESTART, rowLook, SelectionBar, Sheet, TextField, useColors, WARNING } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { useState } from "react";
import type { Conflict } from "../state.ts";
import { type Version, versionKindLabel, versionWhen } from "../versions.ts";

export type SheetState =
  | { kind: "open" }
  | { kind: "save-as" }
  | { kind: "versions" }
  | { kind: "conflict"; after: "close" | null }
  | { kind: "delete-draft" }
  | { kind: "go-to-line" }
  | { kind: "replace" };

/**
 * Revert To…: the file's earlier versions, newest first, one picked; under
 * the list, how the picked one differs from the text now. Reverting is one
 * Undo step, so it doesn't warn.
 */
export function VersionsSheet({
  name,
  versions,
  now,
  describe,
  onRevert,
  onCancel,
}: {
  name: string;
  versions: readonly Version[];
  now: number;
  /** How a version differs from the text now ("Differs from line 12"). */
  describe: (version: Version) => string;
  onRevert: (version: Version) => void;
  onCancel: () => void;
}) {
  const colors = useColors();
  const [picked, setPicked] = useState(0);
  const version = versions[picked];
  return (
    <AlertSheet
      testID="versions"
      width={420}
      question={`Revert “${name}” to an earlier version?`}
      message="Edit › Undo brings back the text you have now."
      glyph={RESTART}
      tone="accent"
      buttons={[
        { label: "Cancel", testID: "versions:cancel", cancel: true, onPress: onCancel },
        { label: "Revert", testID: "versions:revert", kind: "primary", disabled: !version, onPress: () => version && onRevert(version) },
      ]}
    >
      <View focusGroup selectsOnFocus testID="versions:list" style={{ flexDirection: "column", gap: 1, maxHeight: 220, overflow: "scroll" }}>
        {versions.map((each, index) => {
          const look = rowLook(colors, index === picked);
          const kind = versionKindLabel(each.kind);
          return (
            <View
              key={`${each.time}-${each.kind}`}
              testID={`versions:${index}`}
              focusable
              accessibilityRole="option"
              accessibilityState={{ selected: index === picked }}
              onPress={() => setPicked(index)}
              style={{
                position: "relative",
                flexDirection: "row",
                alignItems: "center",
                height: 28,
                paddingHorizontal: 10,
                borderRadius: 6,
                backgroundColor: look.ground,
                hoverBackgroundColor: look.hover,
              }}
            >
              {index === picked && <SelectionBar rowHeight={28} />}
              <Text style={{ fontSize: 13, color: look.ink }}>{versionWhen(each.time, now)}</Text>
              <View style={{ flex: 1 }} />
              {kind !== null && <Text style={{ fontSize: 12, color: look.quiet }}>{kind}</Text>}
            </View>
          );
        })}
      </View>
      <Text style={{ fontSize: 12, color: colors.textMuted }}>
        {version ? describe(version) : "No earlier versions yet: one is kept the first time the file is saved over."}
      </Text>
    </AlertSheet>
  );
}

/** The file changed on disk (or went away) while there were changes here: which text wins. */
export function ConflictSheet({
  name,
  conflict,
  closing,
  onKeepMine,
  onUseDisk,
  onSaveAs,
  onCancel,
}: {
  name: string;
  conflict: Conflict;
  /** Asked as the window closes: Cancel keeps it open. */
  closing: boolean;
  onKeepMine: () => void;
  onUseDisk: () => void;
  onSaveAs: () => void;
  onCancel: () => void;
}) {
  const changed = conflict === "changed";
  return (
    <AlertSheet
      testID="conflict"
      width={440}
      question={changed ? `“${name}” was changed by another app.` : `“${name}” isn't where it was any more.`}
      message={
        changed
          ? "Keep your version, or use the one on disk? Edit › Undo brings yours back after using the one on disk."
          : "It was moved, renamed or deleted. Save it there again, or somewhere else?"
      }
      glyph={WARNING}
      tone="warning"
      buttons={[
        ...(closing ? [{ label: "Cancel", testID: "conflict:cancel", cancel: true, onPress: onCancel }] : []),
        changed
          ? { label: "Use the One on Disk", testID: "conflict:disk", onPress: onUseDisk }
          : { label: "Save As…", testID: "conflict:save-as", onPress: onSaveAs },
        { label: changed ? "Keep Mine" : "Save It There", testID: "conflict:mine", kind: "primary", onPress: onKeepMine },
      ]}
    />
  );
}

/** Go to Line: a line number, the text's last line at most. */
export function GoToLineSheet({ lines, onGo, onCancel }: { lines: number; onGo: (line: number) => void; onCancel: () => void }) {
  const colors = useColors();
  const [input, setInput] = useState("");
  const line = /^\s*\d+\s*$/.test(input) ? Number(input) : null;
  const valid = line !== null && line >= 1;
  const go = (): void => {
    if (line !== null && valid) onGo(Math.min(line, lines));
  };
  return (
    <Sheet testID="go-to-line" width={300} onCancel={onCancel}>
      <Text style={{ fontSize: 13, fontWeight: "bold", color: colors.text }}>Go to Line</Text>
      <Text style={{ fontSize: 12, color: colors.textMuted }}>{`A line from 1 to ${lines.toLocaleString("en-US")}.`}</Text>
      <TextField testID="go-to-line:line" value={input} onChangeText={setInput} autoFocus onSubmit={go} onKeyPress={(key) => key === "Escape" && onCancel()} />
      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
        <Button label="Cancel" testID="go-to-line:cancel" onPress={onCancel} />
        <Button label="Go" testID="go-to-line:ok" primary disabled={!valid} onPress={go} />
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
