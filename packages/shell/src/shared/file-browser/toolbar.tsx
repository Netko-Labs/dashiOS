/**
 * The toolbar's controls: back and forward before the omnibox; view switch,
 * new folder, and the menu after it. In the Trash, Empty is a glyph in New
 * Folder's slot, so the toolbar keeps its shape in every place. A narrow
 * window (`compact`, chrome.ts) leaves both to the "…" menu, which has them.
 * (⇧-click and ❖-click select several: no select mode.)
 */

import { MORE, Segmented, SPACE, ToolbarButton } from "@dashi/ui";
import { View } from "@mirinjs/metal";
import { useFiles, useFilesOps, useFilesState } from "./context.ts";
import { BACK, FOLDER_PLUS, FORWARD, GRID, LIST, sidebarGlyph } from "./glyphs.ts";

export function Leading() {
  const { store } = useFiles();
  const state = useFilesState();
  return (
    <View style={{ flexDirection: "row", gap: SPACE.xxs, flexShrink: 0 }}>
      <ToolbarButton glyph={BACK} tooltip="Back" testID="back" disabled={!state.canBack} onPress={() => store.goBack()} />
      <ToolbarButton glyph={FORWARD} tooltip="Forward" testID="forward" disabled={!state.canForward} onPress={() => store.goForward()} />
    </View>
  );
}

const VIEWS = [
  { value: "icons" as const, label: "Icons", glyph: GRID },
  { value: "list" as const, label: "List", glyph: LIST },
];

/** Icons or List: the kit's Segmented with glyph segments, each named (UI-2). */
export function ViewPicker() {
  const { store } = useFiles();
  const { view } = useFilesState();
  return <Segmented testID="view" options={VIEWS} value={view} onChange={(next) => store.setView(next)} />;
}

export function Controls({
  onNewFolder,
  onMenu,
  menuOpen = false,
  compact = false,
}: {
  onNewFolder: () => void;
  /** "…" was pressed: where the menu's top right goes. */
  onMenu: (point: { x: number; y: number }) => void;
  /** "…"'s menu is open: the button stays lit. */
  menuOpen?: boolean;
  /** A narrow window: New Folder and Empty are in "…" only. */
  compact?: boolean;
}) {
  const { actions } = useFiles();
  const ops = useFilesOps();
  const state = useFilesState();
  return (
    <>
      <ViewPicker />
      {compact ? null : state.location.kind === "trash" ? (
        <ToolbarButton
          glyph={sidebarGlyph("trash")}
          testID="empty-trash"
          tooltip="Empty Trash"
          disabled={state.items.length === 0}
          onPress={actions.confirmEmptyTrash}
        />
      ) : (
        <ToolbarButton glyph={FOLDER_PLUS} testID="new-folder" tooltip="New folder" disabled={!ops.writable} onPress={onNewFolder} />
      )}
      <ToolbarButton
        glyph={MORE}
        testID="more"
        tooltip="More"
        active={menuOpen}
        // Hung from "…": the menu's right edge under the button's (anchor "end" in view.tsx).
        onPress={(event) => onMenu({ x: (event.bounds?.x ?? 0) + (event.bounds?.width ?? 32), y: (event.bounds?.y ?? 0) + (event.bounds?.height ?? 28) + 4 })}
      />
    </>
  );
}
