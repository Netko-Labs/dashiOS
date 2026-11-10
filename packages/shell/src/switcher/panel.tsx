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
          <View
            key={`${index}:${app.appId}`}
            testID={`switcher-app-${index}`}
            onHoverChange={(hovered) => hovered && onPoint?.(index, null)}
            onPress={() => onPick?.(index, null)}
            style={{
              ...at(cell),
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 16,
              backgroundColor: index === selected && selectedWindow === null ? colors.switcherSelection : "#00000000",
            }}
          >
            <Image source={identify(app).icon} style={{ width: ICON, height: ICON, opacity: app.away ? 0.45 : 1 }} />
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
        const chosen = index === selectedWindow;
        const badge = STATE_BADGE[window.state];
        return (
          <View key={`window-${window.id}`}>
            <View
              testID={`switcher-window-${windowStart + index}`}
              onHoverChange={(hovered) => hovered && onPoint?.(selected, windowStart + index)}
              onPress={() => onPick?.(selected, windowStart + index)}
              style={{
                ...at({ x: rect.x - RING, y: rect.y - RING, width: rect.width + 2 * RING, height: rect.height + 2 * RING }),
                borderRadius: 8,
                borderWidth: RING,
                borderColor: chosen ? colors.selection : colors.dockBorder,
              }}
            />
            <View style={{ ...at(title), flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 }}>
              {badge ? (
                <View style={{ paddingHorizontal: 6, height: 16, borderRadius: 8, justifyContent: "center", backgroundColor: colors.button }}>
                  <Text style={{ fontSize: 10, color: colors.textMuted }}>{badge}</Text>
                </View>
              ) : null}
              <Text numberOfLines={1} style={{ fontSize: 11, color: chosen ? colors.text : colors.textMuted, textAlign: "center" }}>
                {window.title || name}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}
