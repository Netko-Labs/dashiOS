/**
 * The sidebar (docs/design.html, "Settings"): its top row is the window's
 * one chrome row on this side, the compositor's window lights and the
 * search field beside them; under it the panes as pills, each with its
 * glyph on a round knob, in the look group and then three plain labels
 * (Connect, This laptop, You). The chosen pane is a soft pill with its knob
 * in the green "on" shape; Agents shows how many agents wait for you.
 * While the search holds text, the sidebar lists what was found instead
 * (find.ts): each setting once, with its own glyph and its pane's name at
 * the end, the one ↑ and ↓ are on chosen.
 *
 * The panes fit a tall window; a shorter one scrolls the list, and the
 * chosen pane is scrolled into view when it changes (from a link, an agent,
 * or the arrows).
 */

import { type Bounds, ScrollView, Text, useWindowChrome, View } from "@mirinjs/metal";
import { useContext, useEffect, useRef } from "react";
import { useControlColors } from "../../shared/controls/palette.ts";
import { type PaneId, paneGroups, SIDEBAR_PANES } from "../../shared/settings/index.ts";
import { SpotContext, scrollFor } from "../spot.tsx";
import type { Found } from "./find.ts";
import { SIDEBAR, topBand } from "./sidebar-measures.ts";
import { GroupLabel, NavPill } from "./sidebar-pill.tsx";
import { SearchPill, type SearchProps } from "./sidebar-search.tsx";

/** What the search found, for the sidebar to list. */
export interface SidebarResults {
  query: string;
  found: readonly Found[];
  /** The result ↑ and ↓ are on. */
  chosen: number;
  onChoose(index: number): void;
}

/** What was found, or that nothing was. */
function Results({ results }: { results: SidebarResults }) {
  const colors = useControlColors();
  if (results.found.length === 0) {
    return (
      <View testID="settings-search-none" style={{ flexShrink: 0, padding: 12 }}>
        {/* One line: a long query is cut, never its closing quote left alone on a second line. */}
        <Text numberOfLines={1} style={{ fontSize: 12, color: colors.muted }}>{`No setting matches “${results.query.trim()}”.`}</Text>
      </View>
    );
  }
  return (
    <View testID="settings-search-results" style={{ flexDirection: "column", gap: SIDEBAR.rowGap, flexShrink: 0 }}>
      {results.found.map((found, index) => (
        <NavPill
          key={found.id}
          testID={`found:${found.id}`}
          label={found.label}
          glyph={found.glyph}
          {...(found.where !== undefined ? { where: found.where } : {})}
          selected={index === results.chosen}
          onPress={() => results.onChoose(index)}
        />
      ))}
    </View>
  );
}

const LIST_ID = "settings-sidebar-list";

export function Sidebar({
  current,
  onSelect,
  shown,
  results,
  search,
  waiting = 0,
}: {
  current: PaneId;
  onSelect: (pane: PaneId) => void;
  shown?: ReadonlySet<PaneId>;
  results?: SidebarResults;
  search: SearchProps;
  /** Agents waiting for you: Agents' count. */
  waiting?: number;
}) {
  const colors = useControlColors();
  const { controls } = useWindowChrome();
  const host = useContext(SpotContext);
  const list = useRef<Bounds | null>(null);
  const rows = useRef(new Map<PaneId, Bounds>());
  const revealed = useRef<PaneId | null>(null);
  // Keep the chosen pane in view: scrolled once each time it changes, as soon as it and the list are laid out.
  const reveal = (): void => {
    const row = rows.current.get(current);
    if (revealed.current === current || !row || !list.current) return;
    revealed.current = current;
    const dy = scrollFor(row, list.current);
    if (dy !== 0) host?.scroll?.(LIST_ID, dy);
  };
  useEffect(reveal);
  // Room for the lights before the field; the whole row but the field is where the window is grabbed.
  const lights = controls ? Math.max(Math.ceil(controls.x + controls.width) - SIDEBAR.paddingX + 8, 0) : 0;
  const band = topBand(controls);
  return (
    <View
      testID="settings-sidebar"
      style={{
        width: SIDEBAR.width,
        flexShrink: 0,
        flexDirection: "column",
        paddingTop: SIDEBAR.paddingTop,
        backgroundColor: colors.sidebar,
      }}
    >
      <View
        testID="settings-sidebar-top"
        dragRegion
        style={{
          height: band.row,
          flexShrink: 0,
          flexDirection: "row",
          alignItems: "center",
          paddingLeft: SIDEBAR.paddingX + lights,
          paddingRight: SIDEBAR.paddingX + 4,
          marginBottom: 2 + band.below,
        }}
      >
        <SearchPill search={search} />
      </View>
      <ScrollView
        testID={LIST_ID}
        onLayout={(laid) => {
          list.current = laid;
          reveal();
        }}
        style={{ flex: 1, flexDirection: "column", paddingLeft: SIDEBAR.paddingX, paddingRight: SIDEBAR.paddingX, paddingBottom: SIDEBAR.paddingBottom }}
      >
        {results && <Results results={results} />}
        {/* One Tab stop for every pane, entered at the chosen one; ↑ and ↓ choose the pane above or below, across the groups (KB-1). */}
        {!results && (
          <View
            testID="settings-sidebar-panes"
            focusGroup
            selectsOnFocus
            style={{ flexDirection: "column", gap: SIDEBAR.rowGap, flexShrink: 0, focusRingColor: colors.focus }}
          >
            {paneGroups(SIDEBAR_PANES.filter((pane) => !pane.optional || shown?.has(pane.id))).flatMap((group) => [
              ...(group.label ? [<GroupLabel key={`label:${group.group}`}>{group.label}</GroupLabel>] : []),
              ...group.panes.map((pane) => (
                <NavPill
                  key={pane.id}
                  testID={`sidebar:${pane.id}`}
                  label={pane.title}
                  glyph={pane.glyph}
                  selected={pane.id === current}
                  {...(pane.id === "agents" ? { badge: waiting } : {})}
                  onPress={() => onSelect(pane.id)}
                  onLayout={(laid) => {
                    rows.current.set(pane.id, laid);
                    if (pane.id === current) reveal();
                  }}
                />
              )),
            ])}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
