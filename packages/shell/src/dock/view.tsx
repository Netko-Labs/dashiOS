/**
 * The Dock: the apps kept in it, then apps that are running without being
 * kept, then minimized windows, a thin divider between the groups and a dot
 * under running ones. A click starts an app, brings it forward, or restores a
 * minimized window. A right-click, or holding the button still, opens the
 * icon's menu above it (menu.ts); dragging a kept icon along the Dock moves
 * it, and dragging it up out of the Dock removes it.
 */

import { useColors } from "@dashi/ui";
import { type Bounds, type PointerInfo, View } from "@mirinjs/metal";
import { useRef } from "react";
import { appFor } from "../apps.ts";
import type { Entry } from "../entries.ts";
import type { MenuController } from "../menus/index.ts";
import type { App } from "../shared/apps/index.ts";
import { DOCK, DOCK_HEIGHT } from "../theme.ts";
import { type ToplevelStore, useToplevels } from "../toplevels.ts";
import { type AttentionStore, useAttention } from "./attention.ts";
import type { Autohide } from "./autohide.ts";
import { type DockController, useStarting } from "./controller.ts";
import { reorderIndex } from "./gesture.ts";
import { Divider, DockIcon } from "./icon.tsx";
import { type DockEntry, dockLayout, type MinimizedEntry, matchEntry } from "./layout.ts";
import { buildDockMenu, buildDockOptionsMenu } from "./menu.ts";
import { type PinStore, usePins } from "./pins.ts";
import type { DockPrefs } from "./prefs.ts";
import { inPreviewOrder, usePress } from "./press.ts";
import { iconRise, Painted, panelOpacity, Slide, type SlideState, useSlide } from "./slide.tsx";
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
  onPanel,
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
  /** Told where the panel is on the surface: only there does the Dock take clicks (start.tsx). */
  onPanel?: (bounds: Bounds) => void;
}) {
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

  // A right-click on an icon opens the icon's menu only: Metal gives it to the innermost view.
  const openMenu = (key: string, centerX: number) => {
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
    if (prefs) void menus.openDockMenu(x, buildDockOptionsMenu(prefs.snapshot), latest.current.appName, output);
  };

  const click = (entry: DockEntry) => {
    if (!swallows(entry.key)) controller.press(entry);
  };

  // While an icon is dragged the others make room for it.
  const pinned = inPreviewOrder(layout.pinned, preview);
  const opacityOf = (key: string) => (preview?.dragging === key ? (preview.pulledOut ? 0.3 : 0.6) : 1);

  return (
    <View
      // An autohiding Dock slides down out of its surface, which clips it.
      style={{
        flex: 1,
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "flex-end",
        position: "relative",
        top: Math.round(slid.position * (DOCK_HEIGHT + DOCK.margin)),
      }}
    >
      <Painted slide={slide} />
      <DockPanel
        pinned={pinned}
        running={layout.running}
        minimized={layout.minimized}
        slid={slid}
        starting={starting}
        wanting={wanting}
        opacityOf={opacityOf}
        tiles={tiles}
        onPanel={onPanel}
        onPress={click}
        onPointer={pointer}
        onMenu={openMenu}
        onOptions={openOptions}
        onRestore={(id) => toplevels.act(id, "activate")}
      />
    </View>
  );
}

/** The Dock's icons in their three groups, on the panel the Dock draws. */
function DockPanel(props: {
  /** The kept apps, in the order they show now (a dragged one moved). */
  pinned: readonly DockEntry[];
  running: readonly DockEntry[];
  minimized: readonly MinimizedEntry[];
  slid: SlideState;
  starting: ReadonlySet<string>;
  wanting: ReadonlySet<string>;
  opacityOf(key: string): number;
  tiles: Pick<TileStore, "set"> | null;
  onPanel?: (bounds: Bounds) => void;
  onPress(entry: DockEntry): void;
  onPointer(entry: DockEntry, place: number | null, centerX: number, event: PointerInfo): void;
  onMenu(key: string, centerX: number): void;
  onOptions(x: number): void;
  onRestore(id: number): void;
}) {
  const colors = useColors();
  const { pinned, running, minimized, slid, tiles } = props;
  return (
    <View
      testID="dock-panel"
      onContextMenu={(event) => props.onOptions(event.x)}
      onLayout={props.onPanel}
      // Past the Dock's edge Metal reports nothing more, not even the release.
      style={{
        opacity: panelOpacity(slid),
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
          running={entry.windows.length > 0 || props.starting.has(entry.key)}
          attention={props.wanting.has(entry.key)}
          opacity={props.opacityOf(entry.key)}
          onPress={() => props.onPress(entry)}
          onPointer={(event, centerX) => props.onPointer(entry, index, centerX, event)}
          onMenu={(centerX) => props.onMenu(entry.key, centerX)}
          onTile={(bounds) => tiles?.set(entry.key, bounds)}
          rise={iconRise(slid.rise, index)}
          testID={`dock-${entry.app.name}`}
        />
      ))}
      {running.length > 0 && <Divider />}
      {running.map((entry, index) => (
        <DockIcon
          key={entry.key}
          icon={entry.app.icon}
          running
          attention={props.wanting.has(entry.key)}
          onPress={() => props.onPress(entry)}
          onPointer={(event, centerX) => props.onPointer(entry, null, centerX, event)}
          onMenu={(centerX) => props.onMenu(entry.key, centerX)}
          onTile={(bounds) => tiles?.set(entry.key, bounds)}
          rise={iconRise(slid.rise, pinned.length + index)}
          testID={`dock-${entry.app.name}`}
        />
      ))}
      {minimized.length > 0 && <Divider />}
      {minimized.map(({ window, app }, index) => (
        <DockIcon
          key={`minimized:${window.id}`}
          icon={app.icon}
          running={false}
          opacity={0.82}
          onPress={() => props.onRestore(window.id)}
          rise={iconRise(slid.rise, pinned.length + running.length + index)}
          testID={`dock-minimized-${window.id}`}
        />
      ))}
    </View>
  );
}
