/** The gallery's structure pages: rows and groups, sidebars and tables, shortcuts and glyphs. */

import {
  type Column,
  Group,
  Caption as GroupCaption,
  glyphs,
  Note,
  Row,
  Shortcut,
  SidebarItem,
  type SortState,
  Switch,
  sortRows,
  Table,
  TINTS,
  Tile,
} from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import { useState } from "react";
import { Caption, Exhibit, Inked, PageBody, States } from "../specimen.tsx";

export function RowsPage() {
  const [on, setOn] = useState(true);
  return (
    <PageBody>
      <Exhibit title="Group of rows" note="A card of rows with hairlines between, a caption over it and a sentence under it.">
        <GroupCaption above>Battery</GroupCaption>
        <Group testID="group:demo">
          <Row label="Low Power Mode" detail="Slows things down to last longer.">
            <Switch testID="group:switch" on={on} onChange={setOn} />
          </Row>
          <Row label="Charge limit">
            <Inked>{(colors) => <Text style={{ fontSize: 12, color: colors.textMuted }}>80%</Text>}</Inked>
          </Row>
        </Group>
        <GroupCaption>The battery lasts longest kept below full.</GroupCaption>
      </Exhibit>
      <Exhibit title="Note and tile" note="A line where there is nothing to show; a glyph on a tile of its tint.">
        <Note testID="note:demo">No devices nearby.</Note>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Tile glyph={glyphs.LOCK} tint={TINTS.mizu} />
          <Tile glyph={glyphs.INFO} tint={TINTS.kabocha} />
          <Tile glyph={glyphs.SEARCH} tint={TINTS.nori} size={32} />
        </View>
      </Exhibit>
    </PageBody>
  );
}

interface Process {
  name: string;
  cpu: number;
}

const PROCESSES: readonly Process[] = [
  { name: "Terminal", cpu: 3.2 },
  { name: "Files", cpu: 0.4 },
  { name: "Text Editor", cpu: 1.1 },
  { name: "Helium", cpu: 12.8 },
];

const COLUMNS: ReadonlyArray<Column<Process>> = [
  { key: "name", title: "Name", text: (row) => row.name },
  { key: "cpu", title: "% CPU", width: 70, align: "right", text: (row) => row.cpu.toFixed(1), sortValue: (row) => row.cpu, descendingFirst: true },
];

export function ListsPage() {
  const [chosen, setChosen] = useState("files");
  const [selected, setSelected] = useState<string | null>("Files");
  const [sort, setSort] = useState<SortState | null>({ key: "cpu", ascending: false });
  return (
    <PageBody>
      <Exhibit title="Sidebar row" note="The selected row is a kombu wash with a 3 px bar; its words and glyph are ink.">
        <States states={["enabled", "selected"]}>
          {({ state, selected }) => (
            <View style={{ width: 200, flexDirection: "column", gap: 2 }}>
              <SidebarItem
                testID={`sidebar:${state}:glyph`}
                label="Documents"
                glyph={glyphs.SEARCH}
                tileColumn
                badge="12"
                selected={selected || chosen === "documents"}
                onPress={() => setChosen("documents")}
              />
              <SidebarItem
                testID={`sidebar:${state}:tile`}
                label="Battery"
                tile={{ glyph: glyphs.LOCK, tint: TINTS.matcha }}
                compact
                selected={selected || chosen === "battery"}
                onPress={() => setChosen("battery")}
              />
            </View>
          )}
        </States>
      </Exhibit>
      <Exhibit title="Table" note="Sortable columns, alternating rows, the one selection look.">
        <View style={{ height: 150, flexDirection: "column" }}>
          <Table
            testID="table:demo"
            columns={COLUMNS}
            rows={sortRows(PROCESSES, COLUMNS, sort)}
            rowKey={(row) => row.name}
            selected={selected}
            onSelect={setSelected}
            sort={sort}
            onSort={setSort}
          />
        </View>
      </Exhibit>
    </PageBody>
  );
}

const SHORTCUTS = ["❖N", "⇧❖Z", "⌃❖Q", "⌥❖Space", "❖⌫", "Esc"] as const;

export function ShortcutsPage() {
  return (
    <PageBody>
      <Exhibit title="Shortcut" note="Keys are drawn, never typed: fonts don't have ❖. Mac order: ⌃ ⌥ ⇧ ❖, then the key.">
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 14 }}>
          {SHORTCUTS.map((keys) => (
            <Inked key={keys}>{(colors) => <Shortcut keys={keys} color={colors.text} />}</Inked>
          ))}
        </View>
      </Exhibit>
      <Exhibit title="Glyphs" note="@dashi/ui's own, on a 16-unit grid, tinted by the ink they are drawn in.">
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
          {Object.entries(glyphs).map(([name, markup]) => (
            // As wide as the longest name (CHEVRON_UP_DOWN), so no name runs past its cell into the card's edge.
            <View key={name} style={{ width: 124, flexDirection: "column", alignItems: "center", gap: 4 }}>
              <Inked>{(colors) => <Svg markup={markup} size={18} color={colors.text} />}</Inked>
              <Caption>{name}</Caption>
            </View>
          ))}
        </View>
      </Exhibit>
      <Exhibit title="Inline" note="A caption can end in a shortcut.">
        <GroupCaption keys="⌃❖Q">Lock the screen with</GroupCaption>
      </Exhibit>
    </PageBody>
  );
}
