/**
 * Text Editor's sheets: Revert To… (the file's earlier versions, as pick
 * rows, versions.ts), the question when the file changed on disk meanwhile,
 * Go to line, and Find and replace. The questions are the one alert frame
 * (UI-5), the forms the kit's FormSheet (UI-15). Open and Save As are Files'
 * chooser (src/shared/file-browser/).
 */

import { AlertSheet, FormSheet, PickList, PickRow, RESTART, SPACE, TextField, TYPE, useColors, WARNING } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { type ReactNode, useState } from "react";
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
/** The versions list's height before it scrolls, and a field's label column in Find and replace. */
const VERSIONS_HEIGHT = 220;
const LABEL_WIDTH = 64;
/** The form sheets' widths. */
const GO_TO_LINE_WIDTH = 300;
const REPLACE_WIDTH = 400;

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
      tone="neutral"
      buttons={[
        { label: "Cancel", testID: "versions:cancel", cancel: true, onPress: onCancel },
        { label: "Revert", testID: "versions:revert", kind: "primary", disabled: !version, onPress: () => version && onRevert(version) },
      ]}
    >
      <View style={{ maxHeight: VERSIONS_HEIGHT, overflow: "scroll" }}>
        {/* Pick rows (UI-13): ↑ ↓ choose, and a press on the chosen one (or Return) reverts to it. */}
        <PickList testID="versions:list">
          {versions.map((each, index) => {
            const kind = versionKindLabel(each.kind);
            return (
              <PickRow
                key={`${each.time}-${each.kind}`}
                testID={`versions:${index}`}
                label={versionWhen(each.time, now)}
                {...(kind !== null ? { detail: kind } : {})}
                chosen={index === picked}
                onPress={() => (index === picked ? onRevert(each) : setPicked(index))}
              />
            );
          })}
        </PickList>
      </View>
      <Text style={{ fontSize: TYPE.secondary.size, color: colors.textMuted }}>
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
      question={changed ? `“${name}” was changed by another app.` : `“${name}” isn’t where it was any more.`}
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
          ? { label: "Use the one on disk", testID: "conflict:disk", onPress: onUseDisk }
          : { label: "Save as…", testID: "conflict:save-as", onPress: onSaveAs },
        { label: changed ? "Keep mine" : "Save it there", testID: "conflict:mine", kind: "primary", onPress: onKeepMine },
      ]}
    />
  );
}

/** Go to line: a line number, the text's last line at most. A form sheet (UI-15); its field takes Return and Esc. */
export function GoToLineSheet({ lines, onGo, onCancel }: { lines: number; onGo: (line: number) => void; onCancel: () => void }) {
  const colors = useColors();
  const [input, setInput] = useState("");
  const line = /^\s*\d+\s*$/.test(input) ? Number(input) : null;
  const valid = line !== null && line >= 1;
  const go = (): void => {
    if (line !== null && valid) onGo(Math.min(line, lines));
  };
  return (
    <FormSheet
      testID="go-to-line"
      title="Go to line"
      width={GO_TO_LINE_WIDTH}
      keys={false}
      buttons={[
        { label: "Cancel", testID: "go-to-line:cancel", cancel: true, onPress: onCancel },
        { label: "Go", testID: "go-to-line:ok", kind: "primary", disabled: !valid, onPress: go },
      ]}
    >
      <Text style={{ fontSize: TYPE.secondary.size, color: colors.textMuted }}>{`A line from 1 to ${lines.toLocaleString("en-US")}.`}</Text>
      <TextField testID="go-to-line:line" value={input} onChangeText={setInput} autoFocus onSubmit={go} onKeyPress={(key) => key === "Escape" && onCancel()} />
    </FormSheet>
  );
}

/** A labelled field in Find and replace: its label in the column before it. */
function Labelled({ label, children }: { label: string; children: ReactNode }) {
  const colors = useColors();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.gap }}>
      <View style={{ width: LABEL_WIDTH }}>
        <Text style={{ fontSize: TYPE.secondary.size, color: colors.textMuted, textAlign: "right" }}>{label}</Text>
      </View>
      {children}
    </View>
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
    <FormSheet
      testID="replace"
      title="Find and replace"
      width={REPLACE_WIDTH}
      keys={false}
      footer={<Text style={{ fontSize: TYPE.secondary.size, color: colors.textMuted }}>{status}</Text>}
      buttons={[
        { label: "Done", testID: "replace:done", cancel: true, onPress: onCancel },
        { label: "Replace all", testID: "replace:all", kind: "primary", disabled: query === "" || matches === 0, onPress: replace },
      ]}
    >
      <Labelled label="Find">
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
      </Labelled>
      <Labelled label="Replace">
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
      </Labelled>
    </FormSheet>
  );
}
