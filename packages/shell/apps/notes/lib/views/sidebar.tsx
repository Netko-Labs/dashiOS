/**
 * The folders column: All Notes, the default folder and the ones you made,
 * Recently Deleted, and New folder, each the kit's SidebarItem. A narrow
 * window shows it as the kit's rail of glyphs, each named by its tooltip
 * with its count (layout.ts, LA-5).
 */

import { SidebarItem, SidebarSection } from "@dashi/ui";
import { View } from "@mirinjs/metal";
import { DEFAULT_FOLDER_NAME } from "../../../../src/shared/notes/index.ts";
import { FOLDER, FOLDER_PLUS, NOTES, TRASH } from "../glyphs.ts";
import type { Source } from "../list.ts";

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
  const folder = (name: string, label: string, menu: boolean) => (
    <View key={`folder:${name}`} testID={`folder-row:${name || "default"}`} onContextMenu={menu ? (event) => onFolderMenu(name, event.x, event.y) : undefined}>
      <SidebarItem
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
        <SidebarItem
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
      <SidebarItem
        testID="source:trash"
        label="Recently Deleted"
        glyph={TRASH}
        badge={counts.deleted > 0 ? String(counts.deleted) : undefined}
        selected={source.kind === "trash"}
        onPress={() => onSource({ kind: "trash" })}
        rail={rail}
      />
      {/* New folder is a place to go to make one: a row like the others, never chosen. */}
      <SidebarItem testID="new-folder" label="New folder" glyph={FOLDER_PLUS} selected={false} onPress={onNewFolder} rail={rail} />
    </>
  );
}
