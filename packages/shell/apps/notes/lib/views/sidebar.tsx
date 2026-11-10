/**
 * The folders column: All Notes, the default folder and the ones you made,
 * Recently Deleted, and New Folder. A narrow window shows it as a rail of
 * glyphs, each named by its tooltip with its count (layout.ts).
 */

import { rowLook, SelectionBar, SIDEBAR_ROW_HEIGHT, SidebarItem, SidebarSection, useColors, useTooltip } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import { DEFAULT_FOLDER_NAME } from "../../../../src/shared/notes/names.ts";
import { FOLDER, FOLDER_PLUS, NOTES, TRASH } from "../glyphs.ts";
import type { Source } from "../list.ts";

export interface FolderCounts {
  all: number;
  deleted: number;
  /** By folder name; "" is the default folder. */
  byFolder: ReadonlyMap<string, number>;
}

/** A place in the sidebar: its row, or on the rail its glyph alone. */
function Place({
  testID,
  label,
  glyph,
  badge,
  selected,
  onPress,
  rail,
}: {
  testID: string;
  label: string;
  glyph: string;
  badge?: string;
  selected: boolean;
  onPress: () => void;
  rail: boolean;
}) {
  const colors = useColors();
  const look = rowLook(colors, selected);
  const tip = useTooltip(rail ? (badge === undefined ? label : `${label} — ${badge}`) : undefined);
  if (!rail) return <SidebarItem testID={testID} label={label} glyph={glyph} badge={badge} selected={selected} onPress={onPress} />;
  return (
    <View
      testID={testID}
      focusable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={() => {
        tip.hide();
        onPress();
      }}
      onHoverChange={tip.onHoverChange}
      style={{
        height: SIDEBAR_ROW_HEIGHT,
        flexShrink: 0,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 7,
        backgroundColor: look.ground,
        hoverBackgroundColor: look.hover,
        focusRingColor: colors.focusRing,
      }}
    >
      {selected && <SelectionBar rowHeight={SIDEBAR_ROW_HEIGHT} />}
      <Svg markup={glyph} size={16} color={look.glyph} />
      {tip.node}
    </View>
  );
}

export function Sidebar({
  folders,
  counts,
  source,
  onSource,
  onNewFolder,
  onFolderMenu,
  rail = false,
}: {
  folders: readonly string[];
  counts: FolderCounts;
  source: Source;
  onSource: (source: Source) => void;
  onNewFolder: () => void;
  onFolderMenu: (name: string, x: number, y: number) => void;
  /** Only the glyphs, each named by its tooltip. */
  rail?: boolean;
}) {
  const colors = useColors();
  const newFolderTip = useTooltip(rail ? "New folder" : undefined);
  const folder = (name: string, label: string, menu: boolean) => (
    <View key={`folder:${name}`} testID={`folder-row:${name || "default"}`} onContextMenu={menu ? (event) => onFolderMenu(name, event.x, event.y) : undefined}>
      <Place
        testID={`folder:${name || "default"}`}
        label={label}
        glyph={FOLDER}
        badge={String(counts.byFolder.get(name) ?? 0)}
        selected={source.kind === "folder" && source.name === name}
        onPress={() => onSource({ kind: "folder", name })}
        rail={rail}
      />
    </View>
  );
  return (
    <>
      <SidebarSection>
        <Place
          testID="source:all"
          label="All Notes"
          glyph={NOTES}
          badge={String(counts.all)}
          selected={source.kind === "all"}
          onPress={() => onSource({ kind: "all" })}
          rail={rail}
        />
      </SidebarSection>
      <SidebarSection {...(rail ? {} : { title: "Folders" })}>
        {folder("", DEFAULT_FOLDER_NAME, false)}
        {folders.map((name) => folder(name, name, true))}
      </SidebarSection>
      <View style={{ flex: 1 }} />
      <Place
        testID="source:trash"
        label="Recently Deleted"
        glyph={TRASH}
        badge={counts.deleted > 0 ? String(counts.deleted) : undefined}
        selected={source.kind === "trash"}
        onPress={() => onSource({ kind: "trash" })}
        rail={rail}
      />
      <View
        testID="new-folder"
        accessibilityRole="button"
        accessibilityLabel="New folder"
        onPress={() => {
          newFolderTip.hide();
          onNewFolder();
        }}
        onHoverChange={newFolderTip.onHoverChange}
        style={{
          height: SIDEBAR_ROW_HEIGHT,
          flexShrink: 0,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: rail ? "center" : "flex-start",
          gap: 9,
          paddingHorizontal: rail ? 0 : 8,
          borderRadius: 7,
          hoverBackgroundColor: colors.button,
        }}
      >
        <Svg markup={FOLDER_PLUS} size={16} color={colors.textMuted} />
        {!rail && <Text style={{ fontSize: 13, color: colors.textMuted }}>New folder</Text>}
        {newFolderTip.node}
      </View>
    </>
  );
}
