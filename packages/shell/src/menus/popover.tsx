/**
 * What the popover surface draws: a transparent sheet over everything below
 * the menu bar, so a click anywhere outside the panel closes it, with the
 * open dropdown, Control Center, or the notification center on it.
 */

import { type NativeHostOptions, Text, View } from "@mirinjs/metal";
import type { ReactElement } from "react";
import { useEffect, useState } from "react";
import { type AppMenuStore, useAppMenus } from "../app-menus/store.ts";
import { BatteryPopover, type BatteryPopoverSources } from "../battery/popover.tsx";
import { ControlCenterPanel, type ControlCenterProps } from "../control-center/index.ts";
import type { DockMenuAction } from "../dock/menu.ts";
import { NotificationCenterPanel, type NotificationStore } from "../notifications/index.ts";
import { DOCK, DOCK_HEIGHT, MENU_BAR_HEIGHT } from "../theme.ts";
import { type MenuController, useMenus } from "./controller.ts";
import { buildMenu, type MenuAction, type MenuEntry } from "./model.ts";
import type { StatusMenuAction } from "./status-menu.ts";
import { DropdownMenu } from "./view.tsx";

/** A status item's menu: the dropdown, telling its owner when it goes, however it went. */
function StatusMenu({
  entries,
  right,
  fromKeys,
  onSide,
  onClosed,
  onClose,
  onChoose,
}: {
  entries: readonly MenuEntry<StatusMenuAction>[];
  right: number;
  fromKeys: boolean;
  onSide: (toward: "left" | "right") => void;
  onClosed: () => void;
  onClose: () => void;
  onChoose: (action: StatusMenuAction) => void;
}) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, when this menu goes.
  useEffect(() => onClosed, []);
  return <DropdownMenu entries={entries} x={right} alignRight fromKeys={fromKeys} onSide={onSide} onClose={onClose} onChoose={onChoose} />;
}

/**
 * What a screen reader says as the bar's ring moves (bar-keys.ts): the
 * ring is drawn on the bar's surface, but the keyboard is this one's, so
 * the stop's name is spoken from here. Only on a host that takes
 * accessibility props.
 */
function BarAnnouncer({ label, accessible }: { label: string | null; accessible: () => boolean }) {
  if (label === null || !accessible()) return null;
  return (
    <View
      testID="bar-announcer"
      accessibilityRole="status"
      accessibilityLiveRegion="polite"
      accessibilityLabel={`${label}, menu bar`}
      style={{ position: "absolute", left: 0, top: 0, width: 1, height: 1, opacity: 0 }}
    >
      <Text style={{ fontSize: 1 }}>{`${label}, menu bar`}</Text>
    </View>
  );
}

type LayerSurface = Exclude<NonNullable<NativeHostOptions["surface"]>, { role: "lock" }>;

/** The surface: everything under the menu bar, which stays clickable (a click on another title switches menus). */
export const POPOVER_SURFACE: LayerSurface = {
  layer: "overlay",
  anchor: ["top", "bottom", "left", "right"],
  // Over the Dock too, and not pushed down by the menu bar's own zone.
  exclusiveZone: -1,
  margin: { top: MENU_BAR_HEIGHT },
  // Exclusive, so Esc and the arrows reach it as soon as it opens.
  keyboard: "exclusive",
  namespace: "dashi.popover",
};

/** The popover surface on the screen with this name (the compositor's choice without one). */
export function popoverSurface(output?: string): LayerSurface {
  return output === undefined ? POPOVER_SURFACE : { ...POPOVER_SURFACE, output };
}

/** How far above the screen's bottom edge a Dock menu ends: the Dock's panel, then a little air. */
const DOCK_MENU_ABOVE = DOCK.margin + DOCK_HEIGHT + 6;

export function PopoverRoot({
  controller,
  appMenus,
  controlCenter,
  notifications,
  dockInset,
  onChoose,
  onDockChoose,
  onStatusChoose,
  onStatusClosed,
  agentsPanel,
  battery,
  overflowRow,
  accessible = () => false,
}: {
  controller: MenuController;
  /** The menus apps published; the open app menu follows its updates. */
  appMenus: AppMenuStore;
  controlCenter: Omit<ControlCenterProps, "page" | "onPage" | "onClose" | "onBattery">;
  notifications: NotificationStore;
  /** How much room the Dock takes at the bottom of that screen (the popover's own) now, asked at each draw (the Dock's settings can change). */
  dockInset: (output?: string) => number;
  /** Runs a chosen row (the popover closes first), with the app name the bar showed. */
  onChoose: (action: MenuAction, appName: string) => void;
  /** Runs a chosen row of a Dock icon's menu (the popover closes first). */
  onDockChoose: (action: DockMenuAction) => void;
  /** Runs a chosen row of a status item's menu (the popover closes first). */
  onStatusChoose: (action: StatusMenuAction) => void;
  /** A status item's menu closed, chosen from or not (a tray icon's dbusmenu wants to know). */
  onStatusClosed?: (key: string) => void;
  /** The agents' panel under their mark (agents-panel.tsx), drawn by its owner. */
  agentsPanel?: (props: { right: number; focus: string | null; close: () => void }) => ReactElement;
  /** The battery panel's stores and what its rows do (battery/popover.tsx). */
  battery?: BatteryPopoverSources;
  /** "…"'s row of the status items that didn't fit (bar-overflow.tsx), drawn by its owner; `escape` is its Esc. */
  overflowRow?: (props: { right: number; keys: readonly string[]; close: () => void; escape: () => void }) => ReactElement;
  /** The Metal host takes accessibility props (launcher/access.ts). */
  accessible?: () => boolean;
}) {
  // The surface's width: the battery panel stays inside it.
  const [width, setWidth] = useState<number | null>(null);
  const { popover, context, appName, output, bar } = useMenus(controller);
  const app = useAppMenus(appMenus);
  const entries = popover?.kind === "menu" && context ? buildMenu(popover.id, { ...context, app }) : [];
  const close = () => controller.close();
  // Esc: back to the bar when the keyboard came from it (bar-keys.ts), else closed.
  const back = () => controller.back();
  const fromBar = bar !== undefined;
  // The app took down the menu that is open (it quit, or changed its menus): close it.
  const vanished = popover?.kind === "menu" && popover.id.startsWith("app:") && entries.length === 0;
  useEffect(() => {
    if (vanished) controller.close();
  }, [vanished, controller]);
  return (
    <View
      style={{ flex: 1 }}
      onLayout={(bounds) => setWidth(bounds.width)}
      // The keys no open menu or panel takes: the bar's, while its ring is there (a panel without keys of its own: Esc).
      onWindowKeyDown={(event) => (popover === null ? controller.barKey(event.key) : event.key === "escape" && back())}
    >
      <View testID="popover-backdrop" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} onPress={close} />
      {popover === null && bar !== undefined && <BarAnnouncer label={controller.labelOf(bar)} accessible={accessible} />}
      {popover?.kind === "menu" && (
        <DropdownMenu
          key={popover.id}
          entries={entries}
          x={popover.x}
          fromKeys={fromBar}
          onSide={(toward) => controller.side(toward)}
          onClose={back}
          onChoose={(action) => {
            close();
            onChoose(action, appName ?? "Desktop");
          }}
        />
      )}
      {popover?.kind === "dock-menu" && (
        <DropdownMenu
          entries={popover.entries}
          x={popover.x}
          above={popover.above ?? DOCK_MENU_ABOVE}
          onClose={close}
          onChoose={(action) => {
            close();
            onDockChoose(action);
          }}
        />
      )}
      {popover?.kind === "status-menu" && (
        <StatusMenu
          key={popover.key}
          entries={popover.entries}
          right={popover.right}
          fromKeys={fromBar}
          onSide={(toward) => controller.side(toward)}
          onClosed={() => onStatusClosed?.(popover.key)}
          onClose={back}
          onChoose={(action) => {
            close();
            onStatusChoose(action);
          }}
        />
      )}
      {popover?.kind === "control-center" && (
        <ControlCenterPanel
          {...controlCenter}
          page={popover.page}
          onPage={(page) => controller.setControlPage(page)}
          onBattery={() => controller.showBatteryFromControlCenter()}
          // Its onClose is Esc on its tiles.
          onClose={back}
        />
      )}
      {popover?.kind === "battery" && battery && <BatteryPopover sources={battery} right={popover.right} screenWidth={width} close={close} onEscape={back} />}
      {/* The agents' panel closes for Esc only: its rows close the menus themselves (handoff-shell.tsx). */}
      {popover?.kind === "agents" && agentsPanel?.({ right: popover.right, focus: popover.focus, close: back })}
      {popover?.kind === "overflow" && overflowRow?.({ right: popover.right, keys: popover.keys, close, escape: back })}
      {popover?.kind === "notification-center" && (
        <NotificationCenterPanel store={notifications} dockInset={dockInset(output)} onClose={close} onEscape={back} />
      )}
    </View>
  );
}
