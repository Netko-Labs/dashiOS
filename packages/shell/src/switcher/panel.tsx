/**
 * The switcher's panel: a cell per app (with a badge counting its windows,
 * dimmed when they are all minimized or hidden), the chosen app's name (and
 * what has been typed), and, after a hold or ↓, the app's windows under the
 * row. The compositor draws each window's live picture over its frame here
 * (`window-thumbnails`, in the rects layout.ts gives); this draws the frames,
 * titles, and badges. The pointer chooses too: hover selects, a click picks.
 */

import { useColors } from "@dashi/ui";
import { Image, Text, View } from "@mirinjs/metal";
import { useSyncExternalStore } from "react";
import type { Rect } from "../layout.ts";
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

/** An app in the row: its icon, lit when it is the one chosen, with how many windows it has. */
function AppCell({ testID, app, icon, cell, lit, onPoint, onPick }: CellProps & { app: SwitcherApp; icon: string; cell: Rect; lit: boolean }) {
  const colors = useColors();
  return (
    <View
      testID={testID}
      onHoverChange={(hovered) => hovered && onPoint()}
      onPress={onPick}
      style={{
        ...at(cell),
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 16,
        backgroundColor: lit ? colors.switcherSelection : "#00000000",
      }}
    >
      <Image source={icon} style={{ width: ICON, height: ICON, opacity: app.away ? 0.45 : 1 }} />
      {app.count > 1 ? (
        <View
          style={{
            position: "absolute",
            right: 4,
            top: 4,
            minWidth: BADGE,
            height: BADGE,
            borderRadius: BADGE / 2,
            paddingHorizontal: 5,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: colors.osdOn,
          }}
        >
          <Text style={{ fontSize: 11, fontWeight: "bold", color: colors.menu }}>{String(app.count)}</Text>
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
        onPress={onPick}
        style={{
          ...at({ x: rect.x - RING, y: rect.y - RING, width: rect.width + 2 * RING, height: rect.height + 2 * RING }),
          borderRadius: 8,
          borderWidth: RING,
          borderColor: chosen ? colors.selection : colors.dockBorder,
        }}
      />
      <View style={{ ...at(titleAt), flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 }}>
        {badge ? (
          <View style={{ paddingHorizontal: 6, height: 16, borderRadius: 8, justifyContent: "center", backgroundColor: colors.button }}>
            <Text style={{ fontSize: 10, color: colors.textMuted }}>{badge}</Text>
          </View>
        ) : null}
        <Text numberOfLines={1} style={{ fontSize: 11, color: chosen ? colors.text : colors.textMuted, textAlign: "center" }}>
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
          borderRadius: 22,
          backgroundColor: colors.launcher,
          borderWidth: 1,
          borderColor: colors.dockBorder,
          shadow: "xl",
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
            icon={identify(app).icon}
            cell={cell}
            lit={index === selected && selectedWindow === null}
            onPoint={() => onPoint?.(index, null)}
            onPick={() => onPick?.(index, null)}
          />
        );
      })}
      <View style={{ ...at(layout.name), alignItems: "center", justifyContent: "center" }}>
        <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: "semibold", color: colors.text, textAlign: "center" }}>
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
