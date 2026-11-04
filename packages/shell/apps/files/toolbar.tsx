/** The toolbar's controls: back and forward before the omnibox; view switch, select-multiple, new folder, and the menu after it. */

import { ToolbarButton, useColors, useSurface } from "@dashi/ui";
import { Svg, View } from "@mirinjs/metal";
import { useFiles, useFilesState } from "./context.ts";
import { BACK, CHECKED, FOLDER_PLUS, FORWARD, GRID, LIST, MORE, sidebarGlyph } from "./glyphs.ts";

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

function ViewSwitch() {
  const colors = useColors();
  const surface = useSurface();
  const { store } = useFiles();
  const { view } = useFilesState();
  const segment = (value: "icons" | "list", glyph: string) => (
    <View
      testID={`view:${value}`}
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
    <View testID="view" style={{ flexDirection: "row", flexShrink: 0, height: 26, padding: 2, gap: 2, borderRadius: 8, backgroundColor: colors.button }}>
      {segment("icons", GRID)}
      {segment("list", LIST)}
    </View>
  );
}

export function Controls({ onNewFolder, onMenu }: { onNewFolder: () => void; onMenu: (point: { x: number; y: number }) => void }) {
  const colors = useColors();
  const { store, ops, actions } = useFiles();
  const state = useFilesState();
  return (
    <>
      <ViewSwitch />
      <View
        testID="multi"
        onPress={() => store.toggleMulti()}
        style={{
          height: 28,
          minWidth: 32,
          borderRadius: 7,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: state.multi ? colors.selection : "#00000000",
          hoverBackgroundColor: state.multi ? colors.selection : colors.button,
        }}
      >
        <Svg markup={CHECKED} size={16} color={state.multi ? "#ffffff" : colors.textMuted} />
      </View>
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
        onPress={(event) => onMenu({ x: (event.bounds?.x ?? 0) - 150, y: (event.bounds?.y ?? 0) + (event.bounds?.height ?? 28) + 4 })}
        style={{ height: 28, minWidth: 32, borderRadius: 7, alignItems: "center", justifyContent: "center", hoverBackgroundColor: colors.button }}
      >
        <Svg markup={MORE} size={16} color={colors.textMuted} />
      </View>
    </>
  );
}
