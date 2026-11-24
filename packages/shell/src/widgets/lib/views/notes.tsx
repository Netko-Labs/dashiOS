/** Notes (plain ink: the person's words): the pinned note, else the newest; blanks on the lock screen. */

import { SPACE } from "@dashi/ui";
import { View } from "@mirinjs/metal";
import { useMemo } from "react";
import { useWidgetEnv } from "../../env.tsx";
import { Glyph, Grow, Head, Lab, Meta, Private, Rule, Title, Words } from "../../parts.tsx";
import type { WidgetSize } from "../../types.ts";
import { ago, shownNote } from "../data.ts";

export function NotesWidget({ size }: { size: WidgetSize }) {
  const { hub, now, locked } = useWidgetEnv();
  // Read when the column draws (the area opened, the minute turned): a small folder.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `now` is the minute that reads the folder again
  const note = useMemo(() => shownNote(hub?.notes() ?? []), [hub, now]);
  if (!note)
    return (
      <>
        <Head left={<Lab>Notes</Lab>} right={<Glyph name="note" size={13} tone="secondary" />} />
        <Grow />
        <Words>No notes yet</Words>
      </>
    );
  const lines = note.body
    .split("\n")
    .map((line) => line.replace(/^#+\s*|^[-*]\s+(\[[ x]\]\s*)?/, "").trim())
    .filter((line) => line !== "" && line !== note.title)
    .slice(0, size === "wide" ? 4 : 3);
  return (
    <>
      <Head left={<Lab>{note.pinned ? "Pinned" : "Latest note"}</Lab>} right={<Meta>{ago(note.modified, now)}</Meta>} />
      <View style={{ height: 10 }} />
      <Private what="Note" width={100}>
        <Title>{note.title}</Title>
      </Private>
      <View style={{ flexDirection: "column", marginTop: SPACE.s }}>
        {lines.map((line, i) => (
          <View key={`${i}${line}`} style={{ flexDirection: "column" }}>
            <Rule />
            <View style={{ paddingTop: SPACE.xs, paddingBottom: SPACE.xs }}>
              <Private what="" width={[86, 64, 100, 72][i] ?? 80}>
                <Words ink>{line}</Words>
              </Private>
            </View>
          </View>
        ))}
      </View>
      <Grow />
      {locked ? <Meta>Unlock to read</Meta> : null}
    </>
  );
}
