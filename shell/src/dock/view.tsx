/**
 * The Dock: the apps kept in it, then apps that are running without being
 * kept, then minimized windows, a thin divider between the groups and a dot
 * under running ones. A click starts an app, brings it forward, or restores a
 * minimized window. A right-click, or holding the button still, opens the
 * icon's menu above it (menu.ts); dragging a kept icon along the Dock moves
 * it, and dragging it up out of the Dock removes it.
 */

import { type Bounds, Image, type PointerInfo, View } from "@mirinjs/metal";
import { useRef } from "react";
import { type App, appFor } from "../apps.ts";
import type { Entry } from "../entries.ts";
import type { MenuController } from "../menus/index.ts";
import { DOCK, DOCK_HEIGHT, useColors } from "../theme.ts";
import { type ToplevelStore, useToplevels } from "../toplevels.ts";
import { type AttentionStore, useAttention } from "./attention.ts";
import type { Autohide } from "./autohide.ts";
import { type DockController, useStarting } from "./controller.ts";
import { reorderIndex } from "./gesture.ts";
import { type DockEntry, dockLayout, matchEntry } from "./layout.ts";
import { buildDockMenu, buildDockOptionsMenu } from "./menu.ts";
import { type PinStore, usePins } from "./pins.ts";
import type { DockPrefs } from "./prefs.ts";
import { inPreviewOrder, usePress } from "./press.ts";
import { Painted, Slide, useSlide } from "./slide.tsx";
import type { TileStore } from "./tiles.ts";

/** Distance between neighboring icons' left edges. */
const SLOT = DOCK.icon + DOCK.gap;

/** The slide of a Dock that stays put. */
const STILL = new Slide();

export function Dock({
  apps,
  catalog,
  pins,
  toplevels,
  controller,
  menus,
  output,
  attention = null,
  prefs = null,
  autohide = null,
  slide = null,
  tiles = null,
}: {
  /** The apps the menu bar names windows by (the Dock's first-run defaults). */
  apps: readonly App[];
  catalog: readonly Entry[];
  pins: PinStore;
  toplevels: ToplevelStore;
  controller: DockController;
  menus: MenuController;
  /** The screen the Dock is on (an output name); its icon menus open there. */
  output?: string;
  /** Apps whose windows asked for attention (a badge until they're focused). */
  attention?: AttentionStore | null;
  /** The Dock's settings: a right-click between the icons offers them. */
  prefs?: Pick<DockPrefs, "snapshot"> | null;
  /** Told while an icon is pressed (the Dock then stays out). */
  autohide?: Autohide | null;
  /** Where an autohiding Dock is on its way in or out. */
  slide?: Slide | null;
  /** Told where each app's icon is, for the minimize animation (animation-targets.ts). */
  tiles?: Pick<TileStore, "set"> | null;
}) {
  const colors = useColors();
  const windows = useToplevels(toplevels);
  const starting = useStarting(controller);
  const wanting = useAttention(attention);
  const layout = dockLayout(usePins(pins), catalog, windows);
  const { preview, pointer: press, swallows } = usePress(pins, autohide);
  const slid = useSlide(slide ?? STILL);

  // The menu bar keeps naming this app while the menu holds the keyboard.
  const focused = windows.find((window) => window.activated);
  const appName = focused ? appFor(apps, focused, (appId) => matchEntry(catalog, appId)).name : "Desktop";
  // Timers and pointer events outlive the render that made them; they read the latest.
  const latest = useRef({ layout, appName });
  latest.current = { layout, appName };

  // A right-click on an icon reaches the Dock too (Metal bubbles it): the icon's menu wins.
  const onIcon = useRef(false);
  const openMenu = (key: string, centerX: number) => {
    onIcon.current = true;
    setTimeout(() => {
      onIcon.current = false;
    }, 0);
    const entry = [...latest.current.layout.pinned, ...latest.current.layout.running].find((each) => each.key === key);
    if (entry) void menus.openDockMenu(centerX, buildDockMenu(entry), latest.current.appName, output);
  };

  const pointer = (entry: DockEntry, place: number | null, centerX: number, event: PointerInfo) =>
    press(entry, place, event, {
      order: layout.pinned.map((each) => each.key),
      targetOf: (from, dx) => reorderIndex(from, dx, SLOT, layout.pinned.length),
      onHold: () => openMenu(entry.key, centerX),
    });

  const openOptions = (x: number) => {
    if (prefs && !onIcon.current) void menus.openDockMenu(x, buildDockOptionsMenu(prefs.snapshot), latest.current.appName, output);
  };

  const click = (entry: DockEntry) => {
    if (!swallows(entry.key)) controller.press(entry);
  };

  // While an icon is dragged the others make room for it.
  const pinned = inPreviewOrder(layout.pinned, preview);
  const { running, minimized } = layout;

  return (
    <View
      // An autohiding Dock slides down out of its surface, which clips it.
      style={{ flex: 1, flexDirection: "column", alignItems: "center", justifyContent: "flex-end", position: "relative", top: Math.round(slid * (DOCK_HEIGHT + DOCK.margin)) }}
    >
      <Painted slide={slide} />
      <View
        testID="dock-panel"
        onContextMenu={(event) => openOptions(event.x)}
        // Past the Dock's edge Metal reports nothing more, not even the release.
        style={{
          flexDirection: "row",
          alignItems: "flex-start",
          gap: DOCK.gap,
          paddingLeft: DOCK.paddingX,
          paddingRight: DOCK.paddingX,
          paddingTop: DOCK.paddingTop,
          paddingBottom: DOCK.paddingBottom,
          borderRadius: DOCK.radius,
          backgroundColor: colors.dock,
          borderWidth: 1,
          borderColor: colors.dockBorder,
        }}
      >
        {pinned.map((entry, index) => (
          <DockIcon
            key={entry.key}
            icon={entry.app.icon}
            running={entry.windows.length > 0 || starting.has(entry.key)}
            attention={wanting.has(entry.key)}
            opacity={preview?.dragging === entry.key ? (preview.pulledOut ? 0.3 : 0.6) : 1}
            onPress={() => click(entry)}
            onPointer={(event, centerX) => pointer(entry, index, centerX, event)}
            onMenu={(centerX) => openMenu(entry.key, centerX)}
            onTile={(bounds) => tiles?.set(entry.key, bounds)}
            testID={`dock-${entry.app.name}`}
          />
        ))}
        {running.length > 0 && <Divider />}
        {running.map((entry) => (
          <DockIcon
            key={entry.key}
            icon={entry.app.icon}
            running
            attention={wanting.has(entry.key)}
            onPress={() => click(entry)}
            onPointer={(event, centerX) => pointer(entry, null, centerX, event)}
            onMenu={(centerX) => openMenu(entry.key, centerX)}
            onTile={(bounds) => tiles?.set(entry.key, bounds)}
            testID={`dock-${entry.app.name}`}
          />
        ))}
        {minimized.length > 0 && <Divider />}
        {minimized.map(({ window, app }) => (
          <DockIcon
            key={`minimized:${window.id}`}
            icon={app.icon}
            running={false}
            opacity={0.82}
            onPress={() => toplevels.act(window.id, "activate")}
            testID={`dock-minimized-${window.id}`}
          />
        ))}
      </View>
    </View>
  );
}

function Divider() {
  const colors = useColors();
  return (
    <View
      style={{
        width: 1,
        height: DOCK.icon - 4,
        marginTop: 2,
        marginLeft: 2,
        marginRight: 2,
        backgroundColor: colors.separator,
      }}
    />
  );
}

function DockIcon({
  icon,
  running,
  attention = false,
  opacity = 1,
  onPress,
  onPointer,
  onMenu,
  onTile,
  testID,
}: {
  icon: string;
  running: boolean;
  /** A window of this app wants attention. */
  attention?: boolean;
  opacity?: number;
  onPress: () => void;
  /** The pointer's phases on the icon, with the icon's center. */
  onPointer?: (event: PointerInfo, centerX: number) => void;
  /** A right-click, with the icon's center. */
  onMenu?: (centerX: number) => void;
  /** Where the icon was laid out (on the Dock's surface). */
  onTile?: (bounds: Bounds) => void;
  testID: string;
}) {
  const colors = useColors();
  // Events carry the icon's bounds when they can; the last layout stands in for the rest.
  const laid = useRef<Bounds | null>(null);
  const centerOf = (bounds?: Bounds) => {
    const box = bounds ?? laid.current;
    return box ? box.x + box.width / 2 : 0;
  };
  return (
    <View
      style={{ flexDirection: "column", alignItems: "center", gap: 3 }}
      onLayout={(bounds) => {
        laid.current = bounds;
        onTile?.(bounds);
      }}
      onPress={onPress}
      onPointer={onPointer && ((event) => onPointer(event, centerOf(event.bounds)))}
      onContextMenu={onMenu && (() => onMenu(centerOf()))}
      testID={testID}
    >
      <View style={{ width: DOCK.icon, height: DOCK.icon }}>
        <Image source={icon} style={{ width: DOCK.icon, height: DOCK.icon, opacity }} />
        {attention && (
          <View
            testID={`${testID}-attention`}
            style={{
              position: "absolute",
              top: -3,
              right: -3,
              width: 14,
              height: 14,
              borderRadius: 7,
              borderWidth: 2,
              borderColor: colors.dock,
              backgroundColor: colors.critical,
            }}
          />
        )}
      </View>
      <View
        style={{
          width: DOCK.dot,
          height: DOCK.dot,
          borderRadius: DOCK.dot / 2,
          backgroundColor: running ? colors.dot : "#00000000",
        }}
      />
    </View>
  );
}
