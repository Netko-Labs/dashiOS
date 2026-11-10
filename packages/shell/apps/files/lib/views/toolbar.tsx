/**
 * The toolbar's controls: back and forward before the omnibox; view switch,
 * new folder, and the menu after it. In the Trash, Empty is a glyph in New
 * Folder's slot, so the toolbar keeps its shape in every place. A narrow
 * window (`compact`, chrome.ts) leaves both to the "…" menu, which has them.
 * (⇧-click and ❖-click select several: no select mode.)
 */

import { MORE, ToolbarButton, useColors, useSurface } from "@dashi/ui";
import { Svg, View } from "@mirinjs/metal";
import { useFiles, useFilesOps, useFilesState } from "../context.ts";
import { BACK, FOLDER_PLUS, FORWARD, GRID, LIST, sidebarGlyph } from "../glyphs.ts";

export function Leading() {
  const { store } = useFiles();
  const state = useFilesState();
  return (
    <View style={{ flexDirection: "row", gap: 2, flexShrink: 0 }}>
      <ToolbarButton glyph={BACK} testID="back" disabled={!state.canBack} onPress={() => store.goBack()} />
      <ToolbarButton glyph={FORWARD} testID="forward" disabled={!state.canForward} onPress={() => store.goForward()} />
    </View>
  );
}

export function ViewSwitch() {
  const colors = useColors();
  const surface = useSurface();
  const { store } = useFiles();
  const { view } = useFilesState();
  const segment = (value: "icons" | "list", glyph: string) => (
    <View
      testID={`view:${value}`}
      focusable
      accessibilityRole="tab"
      accessibilityLabel={value === "icons" ? "Icons" : "List"}
      accessibilityState={{ selected: view === value }}
      onPress={() => store.setView(value)}
      style={{
        width: 34,
        borderRadius: 6,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: view === value ? surface.card : "#00000000",
        ...(view === value ? { shadow: "xs" as const } : {}),
      }}
    >
      <Svg markup={glyph} size={15} color={view === value ? colors.text : colors.textMuted} />
    </View>
  );
  return (
    <View
      testID="view"
      focusGroup
      accessibilityRole="tablist"
      style={{ flexDirection: "row", flexShrink: 0, height: 26, padding: 2, gap: 2, borderRadius: 8, backgroundColor: colors.button }}
    >
      {segment("icons", GRID)}
      {segment("list", LIST)}
    </View>
  );
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
      <ViewSwitch />
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
