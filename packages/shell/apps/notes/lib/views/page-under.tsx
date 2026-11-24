/**
 * What the page draws under the note's field: the shown text laid out again,
 * paragraph by paragraph at each one's size, in no ink (so the field is as
 * tall as its words, and what is drawn here sits where the field leaves room
 * for it), with the things a text field cannot draw in their places: a
 * table as a table, a rule as a line, a code block's panel, a quote's bar.
 * A probe at the figure's size tells how tall a line is for each px of its
 * size, so a table's rows in the field can be sized to the drawn table's
 * height.
 */

import { CLEAR, type Palette, RADIUS, SPACE, TYPE, useColors, WEIGHT } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { type ReactElement, useMemo } from "react";
import { TASK_BOX, type Table, TableView } from "../../../../src/shared/markdown/index.ts";
import { type Para, type Projection, project } from "../project.ts";
import { BODY_SIZE } from "../sizes.ts";

/** About the width of a letter of the body, for a column's least width. */
const LETTER = 7.6;

/** The probe's size: any size measures the factor; a large one measures it finely. Never shown (no ink). */
const PROBE = TYPE.figure.size;
/** A quote's bar: 3 wide, at a thumbnail's radius, a quote's inset left of the words. */
const QUOTE_BAR = { width: 3, inset: SPACE.inset } as const;

/** A paragraph's words, in no ink, as the field lays them out. */
function Line({ para, text }: { para: Para; text: string }) {
  return <Text style={{ fontSize: para.size, fontWeight: para.bold ? WEIGHT.bold : WEIGHT.regular, color: CLEAR }}>{text === "" ? " " : text}</Text>;
}

/** A cell's words as drawn: its Markdown's markers gone, a box as a box. */
const cellText = (cell: string): string => project(cell, null).display.replace(TASK_BOX.open, "☐").replace(TASK_BOX.done, "☑");

/** A table, as the shared view draws it (shared/markdown), at the body's size. */
function NoteTable({ table, onHeight }: { table: Table; onHeight: (height: number) => void }) {
  return <TableView testID="note-table" table={table} cellText={cellText} size={BODY_SIZE} letter={LETTER} onLayout={(bounds) => onHeight(bounds.height)} />;
}

/** The paragraphs of one code block on their panel, or one quote's line beside its bar. */
function Backed({ children, colors, kind }: { children: ReactElement[] | ReactElement; colors: Palette; kind: "code" | "quote" }) {
  const back =
    kind === "code"
      ? { left: -SPACE.m, right: -SPACE.m, top: 0, bottom: 0, borderRadius: RADIUS.row, backgroundColor: colors.button }
      : { left: -QUOTE_BAR.inset, top: SPACE.px, bottom: SPACE.px, width: QUOTE_BAR.width, borderRadius: RADIUS.thumb, backgroundColor: colors.separator };
  return (
    <View style={{ position: "relative", flexDirection: "column" }}>
      <View style={{ position: "absolute", ...back }} />
      {children}
    </View>
  );
}

/** The column's children: each paragraph, or the block a run of them makes. */
function pieces(projection: Projection, colors: Palette, lineHeight: number, onTable: (table: number, height: number) => void): ReactElement[] {
  const { paras } = projection;
  const texts = projection.display.split("\n");
  const out: ReactElement[] = [];
  let index = 0;
  while (index < paras.length) {
    const para = paras[index] as Para;
    const key = `p${index}`;
    let end = index + 1;
    while (para.deco !== "none" && para.deco !== "quote" && para.deco !== "rule" && paras[end]?.deco === para.deco && paras[end]?.group === para.group) end++;
    const table = projection.tables[para.group];
    if (para.deco === "table" && table) out.push(<NoteTable key={key} table={table} onHeight={(height) => onTable(para.group, height)} />);
    else if (para.deco === "code") {
      const lines = paras.slice(index, end).map((each, at) => <Line key={`c${index + at}`} para={each} text={texts[index + at] ?? ""} />);
      out.push(
        <Backed key={key} colors={colors} kind="code">
          {lines}
        </Backed>,
      );
    } else if (para.deco === "quote")
      out.push(
        <Backed key={key} colors={colors} kind="quote">
          <Line para={para} text={texts[index] ?? ""} />
        </Backed>,
      );
    else if (para.deco === "rule")
      out.push(
        <View key={key} style={{ position: "relative", flexDirection: "column" }}>
          <View style={{ position: "absolute", left: 0, right: 0, top: Math.round(lineHeight / 2), height: 1, backgroundColor: colors.separator }} />
          <Line para={para} text=" " />
        </View>,
      );
    else out.push(<Line key={key} para={para} text={texts[index] ?? ""} />);
    index = end;
  }
  return out;
}

export function PageUnder({
  projection,
  lineFactor,
  onHeight,
  onLineFactor,
  onTableHeight,
}: {
  projection: Projection;
  /** A line's height for each px of its size. */
  lineFactor: number;
  onHeight: (height: number) => void;
  onLineFactor: (factor: number) => void;
  onTableHeight: (table: number, height: number) => void;
}) {
  const colors = useColors();
  const children = useMemo(() => pieces(projection, colors, BODY_SIZE * lineFactor, onTableHeight), [projection, colors, lineFactor, onTableHeight]);
  return (
    <View
      testID="body-measure"
      onLayout={(bounds) => onHeight(bounds.height)}
      style={{ position: "absolute", left: 0, top: 0, right: 0, flexDirection: "column" }}
    >
      <View onLayout={(bounds) => onLineFactor(bounds.height / PROBE)} style={{ position: "absolute", left: 0, top: 0, opacity: 0 }}>
        <Text style={{ fontSize: PROBE, color: CLEAR }}> </Text>
      </View>
      {children}
    </View>
  );
}
