/**
 * The editor's body: the text, with Find's matches washed and line numbers
 * in a gutter; the counts, and an encoding or line ending that isn't UTF-8
 * and LF, in a quiet chip at its foot (made way for by a notice); and files
 * dropped on it.
 */

import { statSync } from "node:fs";
import { useColors, useSurface } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { useEffect, useMemo, useState } from "react";
import { lineCount } from "../find.ts";
import type { EditorModel } from "../model.ts";
import type { EditorState } from "../state.ts";
import { formatStats, textStats } from "../stats.ts";
import { countsLine, findHighlights } from "../status.ts";
import type { Selection } from "../use-selection.ts";
import { TextArea } from "./text-area.tsx";

/** How long the counts wait for typing to pause before counting again. */
const COUNT_DELAY_MS = 300;

/** Whether a dropped path is a regular file that can be opened. */
function isOpenable(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** `value`, once it has stayed the same for `ms`. */
function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/** The text's line count, which the gutter and Go to Line use. */
export function useLineCount(text: string): number {
  return useMemo(() => lineCount(text), [text]);
}

export function EditorContent({
  model,
  state,
  lines,
  selection,
  hasNotice,
  openPath,
  newWindow,
  scroll,
}: {
  model: EditorModel;
  state: EditorState;
  lines: number;
  selection: Selection;
  /** A notice floats over the text, and the counts make way for it. */
  hasNotice: boolean;
  openPath: (path: string) => string | null;
  newWindow: (files: readonly string[]) => void;
  scroll: (dy: number, fromTop: boolean) => void;
}) {
  const colors = useColors();
  const { find } = state;
  const counted = useSettled(state.text, COUNT_DELAY_MS);
  const stats = useMemo(() => formatStats(textStats(counted)), [counted]);
  const highlights = useMemo(() => findHighlights(find, colors.findWash, colors.findCurrent), [find, colors.findWash, colors.findCurrent]);
  return (
    <View
      style={{ flex: 1, flexDirection: "column", position: "relative" }}
      onDrop={(drop) => {
        if (drop.phase !== "drop" || drop.paths.length === 0) return;
        const [first, ...rest] = drop.paths;
        if (first !== undefined && isOpenable(first)) openPath(first);
        if (rest.length > 0) newWindow(rest);
      }}
    >
      <TextArea
        text={state.text}
        prefs={state.prefs}
        lines={lines}
        session={state.session}
        selection={selection.selection}
        onSelectionChange={(next) => selection.select(next.start, next.end)}
        highlights={highlights}
        onChange={(text) => model.edit(text)}
        onEscape={() => find.query !== "" && model.setQuery("")}
        scroll={scroll}
        reveal={state.reveal}
      />
      {!hasNotice && <CountsChip text={countsLine({ counts: stats, encoding: state.encoding, lineEnding: state.lineEnding })} />}
    </View>
  );
}

/**
 * The counts at the text's foot, at its right: a quiet pill, as a toolbar's state chip is (VS-5), but on the
 * window's own ground with a hairline edge, since it floats over text that must not show through it.
 */
function CountsChip({ text }: { text: string }) {
  const colors = useColors();
  const surface = useSurface();
  return (
    <View
      testID="counts"
      style={{
        position: "absolute",
        // On the toolbar's right edge (its 12 of padding), so the chip ends under the Find field.
        right: 12,
        bottom: 12,
        height: 24,
        paddingHorizontal: 10,
        borderRadius: 12,
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: surface.window,
        borderWidth: 1,
        borderColor: colors.separator,
      }}
    >
      <Text numberOfLines={1} style={{ fontSize: 11, color: colors.textMuted }}>
        {text}
      </Text>
    </View>
  );
}
