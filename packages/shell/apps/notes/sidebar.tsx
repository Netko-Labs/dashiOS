/** The folders column: All Notes, the default folder and the ones you made, Recently Deleted, and New Folder. */

import { SidebarItem, SidebarSection, useColors } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import { FOLDER, FOLDER_PLUS, NOTES, TRASH } from "./glyphs.ts";
import type { Source } from "./list.ts";
import { DEFAULT_FOLDER_NAME } from "./names.ts";

export interface FolderCounts {
  all: number;
  deleted: number;
  /** By folder name; "" is the default folder. */
  byFolder: ReadonlyMap<string, number>;
}

export function Sidebar({
  folders,
  counts,
  source,
  onSource,
  onNewFolder,
  onFolderMenu,
}: {
  folders: readonly string[];
  counts: FolderCounts;
  source: Source;
  onSource: (source: Source) => void;
  onNewFolder: () => void;
  onFolderMenu: (name: string, x: number, y: number) => void;
}) {
  const colors = useColors();
  const folder = (name: string, label: string, menu: boolean) => (
    <View key={`folder:${name}`} testID={`folder-row:${name || "default"}`} onContextMenu={menu ? (event) => onFolderMenu(name, event.x, event.y) : undefined}>
      <SidebarItem
        testID={`folder:${name || "default"}`}
        label={label}
        glyph={FOLDER}
        badge={String(counts.byFolder.get(name) ?? 0)}
        selected={source.kind === "folder" && source.name === name}
        onPress={() => onSource({ kind: "folder", name })}
      />
    </View>
  );
  return (
    <>
      <SidebarSection>
        <SidebarItem
          testID="source:all"
          label="All Notes"
          glyph={NOTES}
          badge={String(counts.all)}
          selected={source.kind === "all"}
          onPress={() => onSource({ kind: "all" })}
        />
      </SidebarSection>
      <SidebarSection title="Folders">
        {folder("", DEFAULT_FOLDER_NAME, false)}
        {folders.map((name) => folder(name, name, true))}
      </SidebarSection>
      <View style={{ flex: 1 }} />
      <SidebarItem
        testID="source:trash"
        label="Recently Deleted"
        glyph={TRASH}
        badge={counts.deleted > 0 ? String(counts.deleted) : undefined}
        selected={source.kind === "trash"}
        onPress={() => onSource({ kind: "trash" })}
      />
      <View
        testID="new-folder"
        onPress={onNewFolder}
        style={{
          height: 30,
          flexShrink: 0,
          flexDirection: "row",
          alignItems: "center",
          gap: 9,
          paddingHorizontal: 8,
          borderRadius: 7,
          hoverBackgroundColor: colors.button,
        }}
      >
        <Svg markup={FOLDER_PLUS} size={16} color={colors.textMuted} />
        <Text style={{ fontSize: 13, color: colors.textMuted }}>New folder</Text>
      </View>
    </>
  );
}
