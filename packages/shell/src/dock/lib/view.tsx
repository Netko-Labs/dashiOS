/**
 * The Dock: the apps kept in it, then apps that are running without being
 * kept, then minimized windows, then the Trash, a thin divider between the
 * groups and a dot under running ones (panel.tsx draws them). A click starts
 * an app, brings it forward, or restores a minimized window. A right-click,
 * or holding the button still, opens the icon's menu above it (menu.ts);
 * dragging a kept icon along the Dock moves it, and dragging it up out of the
 * Dock removes it. The icon under the pointer is named after a moment
 * (label.tsx, DK-2) and magnified (magnify.ts, DK-6) unless a drag, a menu or
 * a card asking is under way.
 */

import { GLASS } from "@dashi/ui";
import { type Bounds, type PointerInfo, View } from "@mirinjs/metal";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { appFor } from "../../apps.ts";
import type { MenuController } from "../../menus/index.ts";
import type { Entry } from "../../shared/app-entries/index.ts";
import type { App } from "../../shared/apps/index.ts";
import { DOCK, DOCK_HEIGHT } from "../../theme.ts";
import { type ToplevelStore, useToplevels } from "../../toplevels.ts";
import { type AttentionStore, useAttention } from "../attention.ts";
import { type DockBadges, useBadges } from "../badges.ts";
import { type DockController, useStarting } from "../controller.ts";
import { type DockEntry, dockLayout, matchEntry } from "../layout.ts";
import { type PinStore, usePins } from "../pins.ts";
import type { DockPrefs } from "../prefs.ts";
import { dockSign } from "../sign.ts";
import type { TileStore } from "../tiles.ts";
import { type DockTrash, useTrashFull } from "../trash.ts";
import type { Autohide } from "./autohide.ts";
import { reorderIndex } from "./gesture.ts";
import { DockLabel, type LabelAim } from "./label.tsx";
import { magnified, magnifiedSize, magnifyHeadroom } from "./magnify.ts";
import { buildDockMenu, buildDockOptionsMenu, buildTrashMenu } from "./menu.ts";
import { DockPanel, type Hovered } from "./panel.tsx";
import { inPreviewOrder, usePress } from "./press.ts";
import { Painted, Slide, type SlideState, useSlide } from "./slide.tsx";

/** Distance between neighboring icons' left edges. */
const SLOT = DOCK.icon + DOCK.gap;

/** The slide of a Dock that stays put. */
const STILL = new Slide();

interface DockProps {
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
  /** What apps say on their icons (DK-3). */
  badges?: DockBadges | null;
  /** The Trash (DK-4); none without it. */
  trash?: DockTrash | null;
  /** Whether the icon under the pointer grows (DK-6: the setting, and not under Reduce Motion). */
  magnify?: () => boolean;
}

/** The room the Dock's surface keeps above its panel: a magnified icon, and the label over it (DK-2, DK-6). */
export const DOCK_HEADROOM = magnifyHeadroom(DOCK.icon) + GLASS.dock.label.gap + GLASS.dock.label.height;

/** The panel's bounds as clicks go: grown upward while an icon is magnified, so a press on its lifted part lands. */
export function clickBounds(panel: Bounds, magnifying: boolean): Bounds {
  if (!magnifying) return panel;
  const up = magnifyHeadroom(DOCK.icon);
  return { x: panel.x, y: panel.y - up, width: panel.width, height: panel.height + up };
}

/** Where the label aims for the icon under the pointer: its centre, and its top above the surface's foot as drawn. */
export function labelAim(hovered: Hovered, magnifying: boolean): LabelAim | null {
  if (!hovered.bounds) return null;
  const look = magnified(hovered.index, magnifying ? hovered.index : null);
  const grown = magnifiedSize(DOCK.icon, look) - DOCK.icon;
  return { name: hovered.name, centerX: hovered.bounds.x + hovered.bounds.width / 2, iconTop: DOCK_HEIGHT - DOCK.paddingTop + grown + look.lift };
}

/** The Dock's surface: the panel at its foot, in the middle. */
const DOCK_ROOM = { flex: 1, flexDirection: "column", alignItems: "center", justifyContent: "flex-end", position: "relative" } as const;

export function Dock(props: DockProps) {
  const { apps, catalog, pins, toplevels, controller, menus, output, attention = null, prefs = null, autohide = null } = props;
  const { slide = null, tiles = null, onPanel, badges = null, trash = null, magnify = () => false } = props;
  const windows = useToplevels(toplevels);
  const trashFull = useTrashFull(trash);
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

  const { openMenu, openOptions, openTrashMenu } = dockMenus(menus, latest, { output, prefs, trash });

  const pointer = (entry: DockEntry, place: number | null, centerX: number, event: PointerInfo) =>
    press(entry, place, event, {
      order: layout.pinned.map((each) => each.key),
      targetOf: (from, dx) => reorderIndex(from, dx, SLOT, layout.pinned.length),
      onHold: () => openMenu(entry.key, centerX),
    });

  const click = (entry: DockEntry) => {
    if (!swallows(entry.key)) controller.press(entry);
  };

  // While an icon is dragged the others make room for it.
  const pinned = inPreviewOrder(layout.pinned, preview);
  const opacityOf = (key: string) => (preview?.dragging === key ? (preview.pulledOut ? 0.3 : 0.6) : 1);

  // Nothing grows or is named while a drag, a menu or a card asking is under way, nor while the Dock moves.
  const still = useStill(menus, Boolean(preview?.dragging), slid);
  const [hovered, onHover] = useHovered();
  const magnifying = still && hovered !== null && magnify();
  const panelBounds = useClickBounds(onPanel, magnifying);

  return (
    <View
      // An autohiding Dock slides down out of its surface, which clips it.
      style={{ ...DOCK_ROOM, top: Math.round(slid.position * (DOCK_HEIGHT + DOCK.margin)) }}
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
        badges={useBadges(badges)}
        trash={trash ? { full: trashFull } : null}
        magnifyAt={magnifying && hovered ? hovered.index : null}
        tiles={tiles}
        onPanel={(bounds) => {
          panelBounds.current = bounds;
          onPanel?.(clickBounds(bounds, magnifying));
        }}
        onHover={onHover}
        onPress={click}
        onPointer={pointer}
        onMenu={openMenu}
        onOptions={openOptions}
        onRestore={(id) => toplevels.act(id, "activate")}
        onTrash={() => trash?.open()}
        onTrashMenu={openTrashMenu}
        onTrashDrop={(paths) => void trash?.drop(paths)}
      />
      <DockLabel aim={still && hovered ? labelAim(hovered, magnifying) : null} />
    </View>
  );
}

/** Whether the Dock is still: no drag, none of its menus open, no card asking, not moving. Only then is an icon named or magnified. */
function useStill(menus: MenuController, dragging: boolean, slid: SlideState): boolean {
  const menuOpen = useSyncExternalStore(menus.subscribe, () => menus.getSnapshot().popover?.kind === "dock-menu");
  const asking = useSyncExternalStore(dockSign.asking.subscribe, dockSign.asking.getSnapshot);
  return !dragging && !menuOpen && !asking && slid.position === 0 && slid.rise >= 1;
}

/** The panel's last bounds, told again as clicks go whenever magnification starts or ends: the lifted icon takes clicks only while lifted. */
function useClickBounds(onPanel: ((bounds: Bounds) => void) | undefined, magnifying: boolean) {
  const panelBounds = useRef<Bounds | null>(null);
  useEffect(() => {
    if (panelBounds.current) onPanel?.(clickBounds(panelBounds.current, magnifying));
  }, [magnifying, onPanel]);
  return panelBounds;
}

/** The Dock's menus: an icon's (a right-click opens only the innermost view's), the Dock's own, the Trash's. */
function dockMenus(
  menus: MenuController,
  latest: { current: { layout: ReturnType<typeof dockLayout>; appName: string } },
  { output, prefs, trash }: { output: string | undefined; prefs: Pick<DockPrefs, "snapshot"> | null; trash: DockTrash | null },
) {
  const open = (x: number, entries: Parameters<MenuController["openDockMenu"]>[1]) => void menus.openDockMenu(x, entries, latest.current.appName, output);
  return {
    openMenu: (key: string, centerX: number) => {
      const entry = [...latest.current.layout.pinned, ...latest.current.layout.running].find((each) => each.key === key);
      if (entry) open(centerX, buildDockMenu(entry));
    },
    openOptions: (x: number) => {
      if (prefs) open(x, buildDockOptionsMenu(prefs.snapshot));
    },
    openTrashMenu: (centerX: number) => {
      if (!trash) return;
      void trash.refresh();
      open(centerX, buildTrashMenu());
    },
  };
}

/** The icon under the pointer: set when the pointer comes onto one, cleared when it leaves that one. */
function useHovered(): [Hovered | null, (hovered: Hovered | null, key: string) => void] {
  const [hovered, setHovered] = useState<Hovered | null>(null);
  const onHover = (next: Hovered | null, key: string): void => setHovered((now) => (next ? next : now?.key === key ? null : now));
  return [hovered, onHover];
}
