/** The toolbar's controls: back and forward before the omnibox; view switch, new folder, and the menu after it. (⇧-click and ❖-click select several: no select mode.) */

import { ToolbarButton, useColors, useSurface } from "@dashi/ui";
import { Svg, View } from "@mirinjs/metal";
import { useFiles, useFilesOps, useFilesState } from "./context.ts";
import { BACK, FOLDER_PLUS, FORWARD, GRID, LIST, MORE, sidebarGlyph } from "./glyphs.ts";

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

export function Controls({ onNewFolder, onMenu }: { onNewFolder: () => void; onMenu: (point: { x: number; y: number }) => void }) {
  const colors = useColors();
  const { actions } = useFiles();
  const ops = useFilesOps();
  const state = useFilesState();
  return (
    <>
      <ViewSwitch />
      {state.location.kind === "trash" ? (
        <ToolbarButton
          glyph={sidebarGlyph("trash")}
          testID="empty-trash"
          label="Empty"
          disabled={state.items.length === 0}
          onPress={actions.confirmEmptyTrash}
        />
      ) : (
        <ToolbarButton glyph={FOLDER_PLUS} testID="new-folder" disabled={!ops.writable} onPress={onNewFolder} />
      )}
      <View
        testID="more"
        focusable
        accessibilityRole="button"
        accessibilityLabel="More"
        onPress={(event) => onMenu({ x: (event.bounds?.x ?? 0) - 150, y: (event.bounds?.y ?? 0) + (event.bounds?.height ?? 28) + 4 })}
        style={{ height: 28, minWidth: 32, borderRadius: 7, alignItems: "center", justifyContent: "center", hoverBackgroundColor: colors.button }}
      >
        <Svg markup={MORE} size={16} color={colors.textMuted} />
      </View>
    </>
  );
}
