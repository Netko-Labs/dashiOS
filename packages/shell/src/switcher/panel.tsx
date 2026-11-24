/**
 * The switcher's panel: a cell per app (with a badge counting its windows,
 * dimmed when they are all minimized or hidden), the chosen app's name (and
 * what has been typed), and, after a hold or ↓, the app's windows under the
 * row. The compositor draws each window's live picture over its frame here
 * (`window-thumbnails`, in the rects layout.ts gives); this draws the frames,
 * titles, and badges. The pointer chooses too: hover selects, a click picks.
 */

import { Chip, CLEAR, OPACITY, pill, RADIUS, SHADOW, SPACE, TYPE, useColors, WEIGHT } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { useSyncExternalStore } from "react";
import type { Rect } from "../layout.ts";
import { AppIcon } from "../shared/apps/index.ts";
import { ICON, switcherLayout } from "./layout.ts";
import type { SwitcherApp, SwitcherState } from "./types.ts";

/** The current state, for the open panel to re-render from. */
export class SwitcherStore {
  private state: SwitcherState = { selected: 0, apps: [], windows: null, windowStart: 0, selectedWindow: null, query: "", size: { width: 1, height: 1 } };
  private readonly listeners = new Set<() => void>();

  set(state: SwitcherState): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): SwitcherState => this.state;
}

export interface PanelProps {
  store: SwitcherStore;
  identify: (app: SwitcherApp) => { name: string; icon: string };
  /** The pointer over an app (and one of its windows). */
  onPoint?(app: number, window: number | null): void;
  /** A click on an app (or one of its windows). */
  onPick?(app: number, window: number | null): void;
}

const at = (rect: Rect) => ({ position: "absolute" as const, left: rect.x, top: rect.y, width: rect.width, height: rect.height });
const BADGE = 20;
const RING = 2;
const STATE_BADGE: Record<string, string> = { minimized: "Minimized", hidden: "Hidden" };

interface CellProps {
  testID: string;
  /** The pointer came over it. */
  onPoint: () => void;
  onPick: () => void;
}

/** An app in the row: its icon, on the selection's wash when it is the one chosen (CO-9: an icon view washes the whole tile), with how many windows it has. */
function AppCell({
  testID,
  app,
  name,
  icon,
  cell,
  lit,
  onPoint,
  onPick,
}: CellProps & { app: SwitcherApp; name: string; icon: string; cell: Rect; lit: boolean }) {
  const colors = useColors();
  return (
    <View
      testID={testID}
      onHoverChange={(hovered) => hovered && onPoint()}
      onPress={onPick}
      accessibilityRole="option"
      accessibilityLabel={name}
      accessibilityState={{ selected: lit }}
      style={{
        ...at(cell),
        alignItems: "center",
        justifyContent: "center",
        borderRadius: RADIUS.card,
        backgroundColor: lit ? colors.selectionWash : CLEAR,
      }}
    >
      <AppIcon source={icon} style={{ width: ICON, height: ICON, opacity: app.away ? OPACITY.half : 1 }} />
      {app.count > 1 ? (
        <View
          style={{
            position: "absolute",
            right: 4,
            top: 4,
            minWidth: BADGE,
            height: BADGE,
            borderRadius: pill(BADGE),
            paddingHorizontal: SPACE.xs,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: colors.osdOn,
          }}
        >
          <Text style={{ fontSize: TYPE.caption.size, fontWeight: WEIGHT.bold, color: colors.menu }}>{String(app.count)}</Text>
        </View>
      ) : null}
    </View>
  );
}

interface WindowCellProps extends CellProps {
  rect: Rect;
  titleAt: Rect;
  title: string;
  /** "Minimized" or "Hidden", when it is. */
  badge: string | undefined;
  chosen: boolean;
}

/** One of the chosen app's windows: its frame, ringed when chosen, and its title under it. */
function WindowCell({ testID, rect, titleAt, title, badge, chosen, onPoint, onPick }: WindowCellProps) {
  const colors = useColors();
  return (
    <View>
      <View
        testID={testID}
        onHoverChange={(hovered) => hovered && onPoint()}
        accessibilityRole="option"
        accessibilityLabel={title}
        accessibilityState={{ selected: chosen }}
        onPress={onPick}
        style={{
          ...at({ x: rect.x - RING, y: rect.y - RING, width: rect.width + 2 * RING, height: rect.height + 2 * RING }),
          borderRadius: RADIUS.control,
          borderWidth: RING,
          borderColor: chosen ? colors.selection : colors.dockBorder,
        }}
      />
      <View style={{ ...at(titleAt), flexDirection: "row", alignItems: "center", justifyContent: "center", gap: SPACE.s }}>
        {badge ? <Chip label={badge} /> : null}
        <Text numberOfLines={1} style={{ fontSize: TYPE.caption.size, color: chosen ? colors.text : colors.textMuted, textAlign: "center" }}>
          {title}
        </Text>
      </View>
    </View>
  );
}

export function SwitcherPanel({ store, identify, onPoint, onPick }: PanelProps) {
  const colors = useColors();
  const { selected, apps, windows, windowStart, selectedWindow, query, size } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const layout = switcherLayout(size.width, apps.length, windows?.length ?? 0);
  const current = apps[selected];
  const name = current ? identify(current).name : "";
  return (
    <View style={{ width: size.width, height: size.height }}>
      <View
        style={{
          ...at(layout.panel),
          borderRadius: RADIUS.sheet,
          backgroundColor: colors.launcher,
          borderWidth: 1,
          borderColor: colors.dockBorder,
          shadow: SHADOW.xl,
        }}
      />
      {apps.map((app, index) => {
        const cell = layout.apps[index];
        if (!cell) return null;
        return (
          <AppCell
            key={`${index}:${app.appId}`}
            testID={`switcher-app-${index}`}
            app={app}
            name={identify(app).name}
            icon={identify(app).icon}
            cell={cell}
            lit={index === selected && selectedWindow === null}
            onPoint={() => onPoint?.(index, null)}
            onPick={() => onPick?.(index, null)}
          />
        );
      })}
      <View style={{ ...at(layout.name), alignItems: "center", justifyContent: "center" }}>
        <Text numberOfLines={1} style={{ fontSize: TYPE.body.size, fontWeight: WEIGHT.semibold, color: colors.text, textAlign: "center" }}>
          {query ? `${name}  ·  “${query}”` : name}
        </Text>
      </View>
      {(windows ?? []).map((window, index) => {
        const rect = layout.windows[index];
        const title = layout.titles[index];
        if (!rect || !title) return null;
        return (
          <WindowCell
            key={`window-${window.id}`}
            testID={`switcher-window-${windowStart + index}`}
            rect={rect}
            titleAt={title}
            title={window.title || name}
            badge={STATE_BADGE[window.state]}
            chosen={index === selectedWindow}
            onPoint={() => onPoint?.(selected, windowStart + index)}
            onPick={() => onPick?.(selected, windowStart + index)}
          />
        );
      })}
    </View>
  );
}
