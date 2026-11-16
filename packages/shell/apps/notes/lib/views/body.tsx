/**
 * The note's body: one Metal text field that shows the note drawn as what
 * it means (project.ts), with the block the caret is in shown as its
 * Markdown, and the page under it (page-under.tsx) drawing what a field
 * cannot. The note is the Markdown: what the field reports (its text, its
 * caret) is carried back to the source (offsets.ts) before the model hears
 * of it. While a range is selected the shown lines stay as they were, so a
 * drag never moves the words under the pointer; a caret shows its block once
 * it has stayed put a moment (past a click's release).
 * When the body is not being edited, every block is drawn.
 */

import { useColors } from "@dashi/ui";
import { TextInput, View } from "@mirinjs/metal";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Lines, revealedLines } from "../blocks.ts";
import { findMatches } from "../find.ts";
import type { Selection } from "../format.ts";
import { lookOf, type Pressable } from "../look.ts";
import { displaySelection, sourceEdit, sourceSelection, sourceStart } from "../offsets.ts";
import { project } from "../project.ts";
import { BODY_SIZE } from "../sizes.ts";
import { PageUnder } from "./page-under.tsx";

export interface PageProps {
  body: string;
  selection: Selection;
  query: string;
  fieldKey: string;
  wantsFocus: boolean;
  minHeight: number;
  readOnly: boolean;
  /** The person is in the body: the caret's block shows its source. */
  editing: boolean;
  onChange: (body: string) => void;
  onSelection: (selection: Selection) => void;
  onPress: (span: Pressable, offset: number, modified: boolean) => void;
  onLeave: () => void;
  onMeasured: () => void;
}

/** How long the caret must stay put before its block shows its source: past a click's release, so no words move under a pressed pointer. */
export const SETTLE_MS = 150;

/**
 * The caret, and whether the body is edited, once they have stayed put for `SETTLE_MS`. A caret that moved because the
 * text changed is taken at once: the settle is for a caret a click put down, never for keys. Typed fast, the caret never
 * stays put, and a block that becomes a table, a heading or a rule under the keys was drawn while keys still went into
 * it: the field's text changed under them (review 32: `| --- | ------ -- |` saved at 50 ms a key; D303).
 */
function useSettled(selection: Selection, editing: boolean, body: string): { selection: Selection; editing: boolean; typing: boolean } {
  const [settled, setSettled] = useState({ selection, editing, body });
  const { start, end } = selection;
  useEffect(() => {
    const timer = setTimeout(() => setSettled({ selection: { start, end }, editing, body }), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [start, end, editing, body]);
  return body !== settled.body ? { selection, editing, typing: true } : { ...settled, typing: false };
}

/** The lines that show their source: the caret's block once it settled; kept as they were while a range is selected. */
function useRevealed(body: string, current: Selection, editing: boolean): Lines | null {
  const { selection, editing: shows, typing } = useSettled(current, editing, body);
  const kept = useRef<Lines | null>(null);
  if (!shows) {
    kept.current = null;
    return null;
  }
  if (selection.start === selection.end || kept.current === null) {
    const caret = revealedLines(body, selection.start, selection.end);
    // While keys come, what shows its source keeps showing it: a block the caret left by Return is drawn once it settles.
    const was = typing ? kept.current : null;
    const lines = was ? { from: Math.min(was.from, caret.from), to: Math.max(was.to, caret.to) } : caret;
    if (lines.from !== kept.current?.from || lines.to !== kept.current.to) kept.current = lines;
  }
  return kept.current;
}

/** How tall the page's drawn tables are, and a line for each px of its size, as the page under the field measures them. */
function useMeasures(): {
  lineFactor: number;
  tableHeights: ReadonlyMap<number, number>;
  setLineFactor: (factor: number) => void;
  setTableHeight: (table: number, height: number) => void;
} {
  const [lineFactor, setFactor] = useState(1.25);
  const [tableHeights, setHeights] = useState<ReadonlyMap<number, number>>(new Map());
  const setLineFactor = useCallback((factor: number) => {
    if (factor > 0.5 && factor < 3) setFactor((old) => (Math.abs(old - factor) > 0.001 ? factor : old));
  }, []);
  const setTableHeight = useCallback((table: number, height: number) => {
    setHeights((old) => (Math.abs((old.get(table) ?? 0) - height) < 0.5 ? old : new Map(old).set(table, height)));
  }, []);
  return { lineFactor, tableHeights, setLineFactor, setTableHeight };
}

export function Page(props: PageProps) {
  const { body, selection, query, readOnly, onChange, onSelection, onPress, onLeave, onMeasured } = props;
  const colors = useColors();
  const [measured, setMeasured] = useState(0);
  // A read-only page takes no typing: the field is given its text back.
  const [refused, setRefused] = useState(0);
  const { lineFactor, tableHeights, setLineFactor, setTableHeight } = useMeasures();
  const revealed = useRevealed(body, selection, props.editing && !readOnly);
  const projection = useMemo(() => project(body, revealed), [body, revealed]);
  const shown = displaySelection(projection.pieces, selection);
  const look = useMemo(() => {
    const matches = findMatches(body, query)
      .map((match) => displaySelection(projection.pieces, match))
      .filter((match) => match.end > match.start);
    const rowSize = (table: number, rows: number): number => {
      const height = tableHeights.get(table) ?? rows * (BODY_SIZE * lineFactor + 11);
      return height / rows / lineFactor;
    };
    return lookOf(projection.spans, colors, matches, rowSize);
  }, [body, query, projection, colors, tableHeights, lineFactor]);
  // The text the field holds as far as we know: a caret it reports on another text is not this projection's.
  const fieldText = useRef(projection.display);
  fieldText.current = projection.display;
  const fieldSelection = useRef(shown);
  fieldSelection.current = shown;

  return (
    <View style={{ position: "relative", flexDirection: "column", flexShrink: 0, width: "100%" }}>
      <PageUnder
        projection={projection}
        lineFactor={lineFactor}
        onLineFactor={setLineFactor}
        onTableHeight={setTableHeight}
        onHeight={(height) => {
          setMeasured(height);
          onMeasured();
        }}
      />
      <TextInput
        key={props.fieldKey}
        testID="body"
        multiline
        // Tab types a tab in a note's words (a list item takes it as indenting); Shift+Tab still leaves for the title.
        tabBehavior="insert"
        value={projection.display}
        valueRevision={refused}
        placeholder={readOnly ? "" : "Start writing…"}
        autoFocus={props.wantsFocus}
        selection={shown}
        runs={look.runs}
        onChangeText={(next) => {
          if (readOnly) return setRefused((n) => n + 1);
          const edited = sourceEdit(body, projection.pieces, projection.display, next, fieldSelection.current);
          fieldText.current = next;
          onChange(edited);
        }}
        onSelectionChange={(next) => {
          if (fieldText.current !== projection.display) return;
          fieldSelection.current = next;
          onSelection(sourceSelection(projection.pieces, next));
        }}
        onRunPress={(event) => {
          const span = look.pressable.get(event.run);
          if (span) onPress(span, sourceStart(projection.pieces, event.offset), event.modifiers.control || event.modifiers.super);
        }}
        onKeyPress={(key) => key === "Escape" && onLeave()}
        style={{
          width: "100%",
          height: Math.max(props.minHeight, Math.ceil(measured) + 4),
          fontSize: BODY_SIZE,
          padding: 0,
          color: colors.text,
          placeholderColor: colors.textDisabled,
          backgroundColor: "#00000000",
        }}
      />
    </View>
  );
}
