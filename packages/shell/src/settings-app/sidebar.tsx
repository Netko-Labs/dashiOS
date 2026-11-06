/** The sidebar: one row per pane, in groups, the chosen one in the selection look (its wash and bar). */

import { SidebarItem, useColors } from "@dashi/ui";
import { ScrollView, useWindowChrome, View } from "@mirinjs/metal";
import { PANES, type PaneId, paneGroups } from "./panes.ts";
import { useSurface } from "./ui.tsx";

export const SIDEBAR_WIDTH = 200;

/** The sidebar's measures (docs/design.html, "Sidebar"): compact rows, 1 apart in a group, groups 10 apart. */
export const SIDEBAR_LIST = {
  /** The window controls' strip over a unified window (dashi-comp's 38 px row). */
  strip: 38,
  paddingTop: 2,
  paddingBottom: 10,
  row: 28,
  rowGap: 1,
  groupGap: 10,
} as const;

/** How tall the sidebar is with every row showing, for groups of `[4, 5, …]` rows. */
export function sidebarHeight(groups: readonly number[]): number {
  const { strip, paddingTop, paddingBottom, row, rowGap, groupGap } = SIDEBAR_LIST;
  const rows = groups.reduce((sum, count) => sum + count * row + Math.max(count - 1, 0) * rowGap, 0);
  return strip + paddingTop + rows + Math.max(groups.length - 1, 0) * groupGap + paddingBottom;
}

export function Sidebar({ current, onSelect, shown }: { current: PaneId; onSelect: (pane: PaneId) => void; shown?: ReadonlySet<PaneId> }) {
  const colors = useColors();
  const surface = useSurface();
  // The unified title bar: the sidebar runs to the top of the window, and the compositor's window controls sit over
  // this strip. It is empty, and a place to grab the window by.
  const { controls } = useWindowChrome();
  const strip = controls ? Math.ceil(controls.y + controls.height) : 0;
  return (
    <View
      testID="settings-sidebar"
      style={{
        width: SIDEBAR_WIDTH,
        flexShrink: 0,
        flexDirection: "column",
        backgroundColor: surface.sidebar,
        borderRightWidth: 1,
        borderColor: colors.separator,
      }}
    >
      {controls && <View testID="settings-sidebar-top" dragRegion style={{ height: strip, flexShrink: 0 }} />}
      {/* The panes fit the window at its default size, so a pane opened from outside (an agent, a deep link) is in view; a smaller window scrolls the list. */}
      <ScrollView
        testID="settings-sidebar-list"
        style={{
          flex: 1,
          flexDirection: "column",
          padding: 10,
          paddingTop: controls ? SIDEBAR_LIST.paddingTop : 14,
          paddingBottom: SIDEBAR_LIST.paddingBottom,
        }}
      >
        {/* One Tab stop for every pane, entered at the chosen one; ↑ and ↓ choose the pane above or below, across the groups (KB-1). */}
        <View testID="settings-sidebar-panes" focusGroup selectsOnFocus style={{ flexDirection: "column", gap: SIDEBAR_LIST.groupGap, flexShrink: 0 }}>
          {paneGroups(PANES.filter((pane) => !pane.optional || shown?.has(pane.id))).map((group, index) => (
            <View key={index} style={{ flexDirection: "column", gap: SIDEBAR_LIST.rowGap }}>
              {group.map((pane) => (
                <SidebarItem
                  key={pane.id}
                  compact
                  testID={`sidebar:${pane.id}`}
                  label={pane.title}
                  tile={{ glyph: pane.glyph, tint: pane.tint }}
                  selected={pane.id === current}
                  onPress={() => onSelect(pane.id)}
                />
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
