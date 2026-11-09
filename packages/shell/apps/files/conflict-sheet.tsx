/**
 * The question a name collision asks (design.html PA-3): "“report.txt”
 * already exists in Documents.", the two files' sizes and dates side by
 * side, and Skip, Keep Both, or Replace. Replace is ume and click-only: the
 * one there goes to the Trash, and Undo brings it back, but Enter still
 * presses the safe answer, Keep Both. With more collisions to come, a switch
 * answers them all the same way.
 */

import { AlertSheet, Switch, useColors } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { useState } from "react";
import { FileIcon } from "./file-icon.tsx";
import { formatDate, formatSize } from "./format.ts";
import { FOLDER_PLUS } from "./glyphs.ts";
import type { Answer, Conflict, Side } from "./operations.ts";
import { baseName } from "./paths.ts";

/** The question's first line. */
export function conflictQuestion(conflict: Conflict, folderName: string): string {
  return `“${baseName(conflict.existing.path)}” already exists in ${folderName}.`;
}

/** What Replace would do, said before it is pressed. */
export function conflictMessage(conflict: Conflict): string {
  const kind = conflict.existing.folder ? "folder" : "file";
  const verb = conflict.mode === "copy" ? "copying" : "moving";
  // A no-break space holds "the Trash." together, so its last word never stands alone on a line.
  return `Replace it with the one you’re ${verb}? The ${kind} there now goes to the\u00a0Trash.`;
}

/**
 * A side's two lines: what it is and how big over when it was changed. On one line the date was
 * cut ("Today at 12:13 /"); alone on its line even "Nov 3, 2025 at 11:45 PM" fits.
 */
export function sideLines(title: string, side: Pick<Side, "folder" | "size" | "mtime">): { caption: string; date: string } {
  return { caption: `${title} · ${side.folder ? "Folder" : formatSize(side.size)}`, date: formatDate(side.mtime) };
}

function SideCard({ title, side, testID }: { title: string; side: Side; testID: string }) {
  const colors = useColors();
  const { caption, date } = sideLines(title, side);
  return (
    <View testID={testID} style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 8 }}>
      <FileIcon item={{ kind: side.folder ? "folder" : "file", mime: side.mime, path: side.path, name: baseName(side.path) }} size={32} />
      <View style={{ flex: 1, minWidth: 0, flexDirection: "column", gap: 1 }}>
        <Text numberOfLines={1} style={{ fontSize: 11, color: colors.textMuted }}>
          {caption}
        </Text>
        <Text numberOfLines={1} style={{ fontSize: 12, color: colors.text }}>
          {date}
        </Text>
      </View>
    </View>
  );
}

export function ConflictSheet({ conflict, folderName, onAnswer }: { conflict: Conflict; folderName: string; onAnswer: (answer: Answer) => void }) {
  const colors = useColors();
  const [all, setAll] = useState(false);
  const answer = (resolution: Answer["resolution"]) => () => onAnswer({ resolution, all });
  return (
    <AlertSheet
      testID="conflict"
      width={500}
      glyph={FOLDER_PLUS}
      tone="warning"
      question={conflictQuestion(conflict, folderName)}
      message={conflictMessage(conflict)}
      buttons={[
        { label: "Skip", testID: "conflict:skip", onPress: answer("skip"), cancel: true },
        { label: "Keep Both", testID: "conflict:keep", onPress: answer("keep-both"), isDefault: true },
        { label: "Replace", testID: "conflict:replace", onPress: answer("replace"), kind: "danger" },
      ]}
    >
      <View style={{ flexDirection: "row", gap: 12 }}>
        <SideCard title="There now" side={conflict.existing} testID="conflict:existing" />
        <SideCard title={conflict.mode === "copy" ? "Copying" : "Moving"} side={conflict.incoming} testID="conflict:incoming" />
      </View>
      {conflict.remaining > 0 && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Switch testID="conflict:all" on={all} onChange={setAll} />
          <Text style={{ fontSize: 12, color: colors.text }}>{`Do the same for the other ${conflict.remaining === 1 ? "one" : conflict.remaining}`}</Text>
        </View>
      )}
    </AlertSheet>
  );
}
