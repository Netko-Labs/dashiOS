/**
 * The taskbar: the Dock's other style, a bar across the bottom of the screen
 * as in Windows. One button per window (taskbar-model.ts), the apps kept in
 * the Dock first as launchers or with their windows; the focused window's
 * button is lit. A click brings the window forward, minimizes it when it is
 * the focused one, and restores it when it is minimized; a right-click (or a
 * held press) opens the same menu an icon has in the Dock. A kept app's
 * buttons move as one when dragged along the bar, and dragging them up out of
 * the bar unpins the app, as in the Dock (press.ts). The menu bar above keeps
 * the clock and the status icons, so the bar's right side is empty.
 */

import { type Bounds, Image, type PointerInfo, Text, View } from "@mirinjs/metal";
import { useRef } from "react";
import { appFor, type App } from "../apps.ts";
import type { Entry } from "../entries.ts";
import type { MenuController } from "../menus/index.ts";
import { TASKBAR, useColors } from "../theme.ts";
import { useToplevels, type ToplevelStore } from "../toplevels.ts";
import { type AttentionStore, useAttention } from "./attention.ts";
import type { Autohide } from "./autohide.ts";
import { type DockController, useStarting } from "./controller.ts";
import { reorderByCenters, reorderIndex } from "./gesture.ts";
import { dockLayout, matchEntry } from "./layout.ts";
import { buildDockMenu, buildDockOptionsMenu } from "./menu.ts";
import { type PinStore, usePins } from "./pins.ts";
import type { DockPrefs } from "./prefs.ts";
import { inPreviewOrder, type PressSetup, usePress } from "./press.ts";
import { Painted, Slide, useSlide } from "./slide.tsx";
import type { TileStore } from "./tiles.ts";
import { type TaskbarButton, taskbarButtons, taskbarCenters } from "./taskbar-model.ts";

/** The distance a drag must cover to pass a neighbor when the buttons have not been measured. */
const UNMEASURED_SLOT = 100;

/** Only a press going down brings its setup; the phases after it use the one it made. */
const NO_SETUP: PressSetup = { order: [], targetOf: (from) => from, onHold: () => {} };

/** The slide of a bar that stays put. */
const STILL = new Slide();

export function Taskbar({
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
  /** The screen the bar is on (an output name); its menus open there. */
  output?: string;
  attention?: AttentionStore | null;
  prefs?: Pick<DockPrefs, "snapshot"> | null;
  /** Told while a button is pressed (the bar then stays out). */
  autohide?: Autohide | null;
  slide?: Slide | null;
  /** Told where each app's first button is, for the minimize animation (animation-targets.ts). */
  tiles?: Pick<TileStore, "set"> | null;
}) {
  const colors = useColors();
  const windows = useToplevels(toplevels);
  const starting = useStarting(controller);
  const wanting = useAttention(attention);
  const layout = dockLayout(usePins(pins), catalog, windows);
  const slid = useSlide(slide ?? STILL);
  const { preview, pointer: press, swallows } = usePress(pins, autohide);
  // While an app is dragged the others make room for it.
  const buttons = taskbarButtons({ ...layout, pinned: [...inPreviewOrder(layout.pinned, preview)] });
  // An app's windows aim at its first button.
  const firstOfApp = new Map<string, string>();
  for (const button of buttons) if (!firstOfApp.has(button.entry.key)) firstOfApp.set(button.entry.key, button.key);
  /** Where each button was last laid out (window pixels); a drag measures the kept apps' groups from this. */
  const laid = useRef(new Map<string, Bounds>());

  const focused = windows.find((window) => window.activated);
  const appName = focused ? appFor(apps, focused, (appId) => matchEntry(catalog, appId)).name : "Desktop";
  const latest = useRef({ buttons, appName, layout });
  latest.current = { buttons, appName, layout };

  const above = TASKBAR.height + 6;
  // A right-click on a button reaches the bar too (Metal bubbles it): the button's menu wins.
  const onButton = useRef(false);
  const openMenu = (key: string, x: number) => {
    onButton.current = true;
    setTimeout(() => {
      onButton.current = false;
    }, 0);
    const button = latest.current.buttons.find((each) => each.key === key);
    if (button) void menus.openDockMenu(x, buildDockMenu(button.entry), latest.current.appName, output, above);
  };

  /** What a press on `button` needs: the kept apps' order, where a drag drops, and the menu a hold opens. */
  const setupFor = (button: TaskbarButton, x: number): PressSetup => {
    const order = latest.current.layout.pinned.map((entry) => entry.key);
    const centers = taskbarCenters(order, latest.current.buttons, laid.current);
    return {
      order,
      targetOf: (from, dx) => (centers ? reorderByCenters(centers, from, dx) : reorderIndex(from, dx, UNMEASURED_SLOT, order.length)),
      onHold: () => openMenu(button.key, x),
    };
  };

  const pointer = (button: TaskbarButton, event: PointerInfo) => {
    const place = button.entry.pinned ? latest.current.layout.pinned.findIndex((entry) => entry.key === button.entry.key) : -1;
    press(button.entry, place < 0 ? null : place, event, event.phase === "down" ? setupFor(button, event.x) : NO_SETUP);
  };

  return (
    <View
      testID="taskbar"
      onContextMenu={(event) => {
        if (prefs && !onButton.current) void menus.openDockMenu(event.x, buildDockOptionsMenu(prefs.snapshot), appName, output, above);
      }}
      style={{
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingLeft: 8,
        paddingRight: 8,
        backgroundColor: colors.dock,
        borderTopWidth: 1,
        borderColor: colors.dockBorder,
        position: "relative",
        top: Math.round(slid * TASKBAR.height),
      }}
    >
      <Painted slide={slide} />
      {buttons.map((button) => (
        <TaskbarItem
          key={button.key}
          button={button}
          running={button.window !== null || starting.has(button.entry.key)}
          lit={button.window?.activated === true}
          attention={wanting.has(button.entry.key)}
          dim={preview?.dragging === button.entry.key ? (preview.pulledOut ? 0.3 : 0.6) : 1}
          onPress={() => {
            if (!swallows(button.entry.key)) controller.pressButton(button);
          }}
          onPointer={(event) => pointer(button, event)}
          onLayout={(bounds) => {
            laid.current.set(button.key, bounds);
            if (firstOfApp.get(button.entry.key) === button.key) tiles?.set(button.entry.key, bounds);
          }}
          onMenu={(x) => openMenu(button.key, x)}
        />
      ))}
    </View>
  );
}

function TaskbarItem({
  button,
  running,
  lit,
  attention,
  dim,
  onPress,
  onPointer,
  onLayout,
  onMenu,
}: {
  button: TaskbarButton;
  running: boolean;
  lit: boolean;
  attention: boolean;
  /** How faint it is drawn while its app is dragged. */
  dim: number;
  onPress: () => void;
  onPointer: (event: PointerInfo) => void;
  /** Where the button was laid out (window pixels): a drag measures from it, and the minimize animation aims at it. */
  onLayout: (bounds: Bounds) => void;
  /** A right-click, at that x. */
  onMenu: (x: number) => void;
}) {
  const colors = useColors();
  const minimized = button.window?.minimized === true;
  const name = button.entry.app.name;
  return (
    <View
      testID={button.window ? `taskbar-${name}-${button.window.id}` : `taskbar-${name}`}
      onPress={onPress}
      onPointer={onPointer}
      onLayout={onLayout}
      onContextMenu={(event) => onMenu(event.x)}
      style={{
        flexDirection: "column",
        alignItems: "stretch",
        justifyContent: "center",
        height: TASKBAR.buttonHeight,
        maxWidth: TASKBAR.buttonMaxWidth,
        paddingLeft: 8,
        paddingRight: 8,
        borderRadius: TASKBAR.radius,
        backgroundColor: lit ? colors.switcherSelection : "#00000000",
        hoverBackgroundColor: lit ? colors.switcherSelection : colors.hover,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, opacity: (minimized ? 0.6 : 1) * dim }}>
        <Image source={button.entry.app.icon} style={{ width: TASKBAR.icon, height: TASKBAR.icon }} />
        {button.label !== "" && (
          <View style={{ flexShrink: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ fontSize: 12, color: colors.text, fontWeight: lit ? "semibold" : "normal" }}>
              {button.label}
            </Text>
          </View>
        )}
        {attention && <View testID={`taskbar-${name}-attention`} style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.critical }} />}
      </View>
      {/* The mark under a running app, longer under the focused one. */}
      <View
        style={{
          position: "absolute",
          bottom: 2,
          alignSelf: "center",
          left: lit ? 10 : 18,
          right: lit ? 10 : 18,
          height: 2,
          borderRadius: 1,
          backgroundColor: running ? colors.dot : "#00000000",
        }}
      />
    </View>
  );
}
