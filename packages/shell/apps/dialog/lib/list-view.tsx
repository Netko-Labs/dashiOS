/**
 * `--list`: the prompt and a table of the rows, with a tick box (or a radio
 * button) first for `--checklist` (`--radiolist`). A click picks a row, or
 * ticks it in a checklist; the arrows move, Space ticks, Enter is OK. OK
 * prints the chosen rows' column (list.ts) and exits 0. Rows come from the
 * command line, or from stdin one cell a line as they arrive.
 */

import { type Column, glyphs, type KeyInput, moveSelection, type SortState, sortRows, Table, useColors } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import { useEffect, useMemo, useState } from "react";
import { type Answer, DialogFrame, standardButtons } from "./frame.tsx";
import { initialTicks, type ListRow, listOutput, rowsFrom, shownColumns } from "./list.ts";
import type { ListSpec } from "./spec.ts";
import { readStdinLines } from "./stdin.ts";

const TOGGLE_WIDTH = 34;

/** A row's tick box or radio button, drawn only: a click anywhere on the row ticks it. */
function Toggle({ on, radio, testID }: { on: boolean; radio: boolean; testID: string }) {
  const colors = useColors();
  return (
    <View
      testID={testID}
      style={{
        width: 14,
        height: 14,
        borderRadius: radio ? 7 : 4,
        borderWidth: on ? 0 : 1.5,
        borderColor: colors.checkbox,
        backgroundColor: on ? colors.selection : "#00000000",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {on &&
        (radio ? (
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: "#ffffff" }} />
        ) : (
          <Svg markup={glyphs.CHECK} size={11} color="#ffffff" />
        ))}
    </View>
  );
}

/** The cells as they come: the command line's, or stdin's, a line each. */
function useCells(initial: readonly string[]): string[] {
  const [cells, setCells] = useState<string[]>(() => [...initial]);
  const fromStdin = initial.length === 0;
  useEffect(() => {
    if (!fromStdin) return;
    return readStdinLines(
      (line) => setCells((now) => [...now, line.replace(/\r$/, "")]),
      () => {},
    );
  }, [fromStdin]);
  return cells;
}

/** The columns shown; a list with ticks draws its first as the tick. */
function listColumns(spec: ListSpec, ticks: { ticked: Set<number>; radio: boolean } | null): Column<ListRow>[] {
  return shownColumns(spec.columns.length, spec.hiddenColumns).map((index) =>
    ticks && index === 0
      ? {
          key: `c${index}`,
          title: spec.columns[index] ?? "",
          width: TOGGLE_WIDTH,
          text: (row) => (ticks.ticked.has(row.id) ? "TRUE" : "FALSE"),
          cell: (row) => <Toggle on={ticks.ticked.has(row.id)} radio={ticks.radio} testID={`dialog:tick:${row.id}`} />,
        }
      : { key: `c${index}`, title: spec.columns[index] ?? "", text: (row) => row.cells[index] ?? "" },
  );
}

export function ListDialog({ spec, answer }: { spec: ListSpec; answer: Answer }) {
  const colors = useColors();
  const cells = useCells(spec.cells);
  const rows = useMemo(() => rowsFrom(cells, spec.columns.length), [cells, spec.columns.length]);
  const toggles = spec.mode !== "plain";
  const radio = spec.mode === "radiolist";
  const [ticks, setTicks] = useState<Set<number> | null>(null);
  // Ticks start from the rows' TRUE cells; rows from stdin may still be coming in.
  const ticked = ticks ?? (toggles ? initialTicks(rows, radio ? "radiolist" : "checklist") : new Set<number>());
  const [selected, setSelected] = useState<number | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [sort, setSort] = useState<SortState | null>(null);

  const tick = (id: number): void =>
    setTicks(() => {
      if (radio) return new Set([id]);
      const next = new Set(ticked);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const choose = (id: number): void => {
    setSelected(id);
    if (toggles) tick(id);
    else if (spec.multiple)
      setPicked((now) => {
        const next = new Set(now);
        if (!next.delete(id)) next.add(id);
        return next;
      });
  };

  const columns = listColumns(spec, toggles ? { ticked, radio } : null);
  const shown = sortRows(rows, columns, sort);

  const chosen = (): Set<number> => (toggles ? ticked : spec.multiple ? picked : new Set(selected === null ? [] : [selected]));
  const ok = (): void => {
    const output = listOutput(rows, chosen(), { printColumns: spec.printColumns, separator: spec.separator, toggles });
    answer(0, output ?? undefined);
  };
  const onKey = (key: KeyInput): void => {
    if (key.kind === "up" || key.kind === "down") {
      const next = moveSelection(
        shown.map((row) => row.id),
        selected,
        key.kind,
      );
      if (next !== null) {
        setSelected(next);
        if (!toggles && spec.multiple) setPicked(new Set([next]));
      }
    } else if (key.kind === "text" && key.text === " " && toggles && selected !== null) {
      tick(selected);
    }
  };
  const buttons = standardButtons({ okLabel: spec.okLabel, cancelLabel: spec.cancelLabel, extraButtons: spec.extraButtons, answer, onOk: ok });
  return (
    <DialogFrame title={spec.title} buttons={buttons} onCancel={() => answer(1)} onKey={onKey}>
      {spec.text !== "" && (
        <View testID="dialog:text">
          <Text style={{ fontSize: 13, color: colors.text, lineHeight: 17 }}>{spec.text}</Text>
        </View>
      )}
      <View style={{ flex: 1, minHeight: 0, borderRadius: 8, borderWidth: 1, borderColor: colors.separator, overflow: "hidden" }}>
        <Table
          testID="dialog:list"
          columns={columns}
          rows={shown}
          rowKey={(row) => row.id}
          selected={selected}
          {...(!toggles && spec.multiple ? { selectedKeys: picked } : {})}
          onSelect={choose}
          sort={sort}
          onSort={setSort}
          header={!spec.hideHeader}
        />
      </View>
    </DialogFrame>
  );
}
