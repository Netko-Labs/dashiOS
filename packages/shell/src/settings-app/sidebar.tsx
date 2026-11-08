/**
 * The sidebar (docs/design.html, "Settings"): its top row is the window's
 * one chrome row on this side, the compositor's window lights and the
 * search field beside them; under it the panes as pills, each with its
 * glyph on a round knob, in the look group and then three plain labels
 * (Connect, This laptop, You). The chosen pane is a soft pill with its knob
 * in the green "on" shape; Agents shows how many agents wait for you.
 * While the search holds text, the sidebar lists what was found instead
 * (find.ts), the one ↑ and ↓ are on chosen.
 *
 * The panes fit a tall window; a shorter one scrolls the list, and the
 * chosen pane is scrolled into view when it changes (from a link, an agent,
 * or the arrows).
 */

import { type Bounds, ScrollView, Svg, Text, TextInput, useWindowChrome, View } from "@mirinjs/metal";
import { useContext, useEffect, useRef } from "react";
import { useControlColors } from "../shared/controls/palette.ts";
import { Knob } from "../shared/controls/parts.tsx";
import type { Found } from "./find.ts";
import { SEARCH } from "./knob-glyphs.ts";
import { type PaneId, paneGroups, SIDEBAR_PANES } from "./panes.ts";
import { SpotContext, scrollFor } from "./spot.tsx";

/** The sidebar's measures (docs/design.html, "Settings"). */
export const SIDEBAR = {
  width: 232,
  /** The top row, lights and search: at least this tall, centred on the lights. */
  bar: 46,
  search: 32,
  paddingTop: 5,
  paddingX: 10,
  paddingBottom: 10,
  row: 30,
  rowGap: 1,
  knob: 26,
  /** A group's label: 10.5 SemiBold, 7 over and 2 under. */
  label: 22,
} as const;

/** The badge's purple: the agents' and the keyboard ring's. */
const BADGE = "#6e56cf";

/** How tall the list is with every row showing, for groups of `[5, 3, …]` rows, the first unlabelled. */
export function sidebarListHeight(groups: readonly number[]): number {
  const rows = groups.reduce((sum, count) => sum + count, 0);
  const labels = Math.max(groups.length - 1, 0);
  return rows * SIDEBAR.row + Math.max(rows - 1, 0) * SIDEBAR.rowGap + labels * (SIDEBAR.label + SIDEBAR.rowGap);
}

/** The top row's height: the lights' centre is its centre, and it is never shorter than the design's 46. */
export function barHeight(controls: Bounds | null): number {
  if (!controls) return SIDEBAR.bar;
  return Math.max(SIDEBAR.bar - SIDEBAR.paddingTop, Math.ceil(2 * (controls.y + controls.height / 2) - SIDEBAR.paddingTop));
}

export interface SearchProps {
  query: string;
  onQuery(query: string): void;
  onKey(key: "Escape" | "ArrowUp" | "ArrowDown"): void;
  onSubmit(): void;
  /** Bumped by ❖F: the field is made again, asking for the keyboard (find.ts `FindFocus`). */
  focusSerial: number;
}

/** The search field: a 32-tall pill the color of an off tile. */
function SearchPill({ search }: { search: SearchProps }) {
  const colors = useControlColors();
  return (
    <View
      style={{
        flex: 1,
        minWidth: 0,
        height: SIDEBAR.search,
        flexDirection: "row",
        alignItems: "center",
        gap: 7,
        paddingLeft: 10,
        paddingRight: 10,
        borderRadius: SIDEBAR.search / 2,
        backgroundColor: colors.off,
      }}
    >
      <Svg markup={SEARCH} size={15} color={colors.muted} />
      <TextInput
        key={search.focusSerial}
        testID="settings-search"
        value={search.query}
        placeholder="Search"
        {...(search.focusSerial > 0 ? { autoFocus: true } : {})}
        onChangeText={search.onQuery}
        onSubmitEditing={() => search.onSubmit()}
        onKeyPress={(key) => {
          // Esc empties the field first, as on the Mac; ↑ and ↓ move through what it found.
          if (key === "Escape" && search.query !== "") search.onQuery("");
          else search.onKey(key);
        }}
        style={{ flex: 1, height: 24, padding: 2, fontSize: 12.5, color: colors.text, placeholderColor: colors.muted, backgroundColor: "#00000000" }}
      />
    </View>
  );
}

/** A pane as a pill: its knob, its name, a count at the end; chosen, the knob is green and tighter. */
function NavPill({
  testID,
  label,
  glyph,
  selected,
  badge,
  onPress,
  onLayout,
}: {
  testID: string;
  label: string;
  glyph: string;
  selected: boolean;
  badge?: number;
  onPress: () => void;
  onLayout?: (bounds: Bounds) => void;
}) {
  const colors = useControlColors();
  return (
    <View
      testID={testID}
      focusable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      {...(onLayout ? { onLayout } : {})}
      style={{
        height: SIDEBAR.row,
        flexShrink: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: 9,
        paddingLeft: 3,
        paddingRight: 10,
        borderRadius: SIDEBAR.row / 2,
        backgroundColor: selected ? colors.off : "#00000000",
        hoverBackgroundColor: selected ? colors.off : colors.knobOff,
        focusRingColor: colors.focus,
      }}
    >
      <Knob glyph={glyph} size={SIDEBAR.knob} glyphSize={15} on={selected} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: selected ? "semibold" : "normal", color: colors.text }}>
          {label}
        </Text>
      </View>
      {badge !== undefined && badge > 0 && (
        <View
          testID={`${testID}:badge`}
          style={{
            height: 18,
            minWidth: 18,
            paddingLeft: 6,
            paddingRight: 6,
            borderRadius: 9,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: BADGE,
          }}
        >
          <Text style={{ fontSize: 10.5, fontWeight: "semibold", color: "#ffffff" }}>{String(badge)}</Text>
        </View>
      )}
    </View>
  );
}

/** A group's plain label. */
function GroupLabel({ children }: { children: string }) {
  const colors = useControlColors();
  return (
    <View style={{ height: SIDEBAR.label, flexShrink: 0, justifyContent: "flex-end", paddingLeft: 10, paddingBottom: 2 }}>
      <Text style={{ fontSize: 10.5, fontWeight: "semibold", color: colors.muted }}>{children.toUpperCase()}</Text>
    </View>
  );
}

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
        <Text style={{ fontSize: 12, color: colors.muted }}>{`Nothing in Settings matches “${results.query.trim()}”.`}</Text>
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
          height: barHeight(controls),
          flexShrink: 0,
          flexDirection: "row",
          alignItems: "center",
          paddingLeft: SIDEBAR.paddingX + lights,
          paddingRight: SIDEBAR.paddingX + 4,
          marginBottom: 2,
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
