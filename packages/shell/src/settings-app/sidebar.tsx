/** The sidebar: one row per pane, in groups, the chosen one on the accent. */

import { ScrollView, useWindowChrome, View } from "@mirinjs/metal";
import { Fragment } from "react";
import { SidebarItem, useColors } from "@dashi/ui";
import { type PaneId, paneGroups } from "./panes.ts";
import { useSurface } from "./ui.tsx";

export const SIDEBAR_WIDTH = 200;

export function Sidebar({ current, onSelect }: { current: PaneId; onSelect: (pane: PaneId) => void }) {
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
      <ScrollView testID="settings-sidebar-list" style={{ flex: 1, flexDirection: "column", gap: 10, padding: 10, paddingTop: controls ? 2 : 14 }}>
        {paneGroups().map((group, index) => (
          <Fragment key={index}>
            <View style={{ flexDirection: "column", gap: 1 }}>
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
          </Fragment>
        ))}
      </ScrollView>
    </View>
  );
}
