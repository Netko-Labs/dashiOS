/**
 * The menu bar: the Dashi menu and the focused app's name and menus on the
 * left, status and the clock on the right. A click opens a title's menu (the
 * pointer then moves between menus without clicking), a click on the status
 * area opens Control Center (the battery has its own menu), and a click on
 * the clock the notification center (menus/). Programs' own items, tray
 * icons and applets, sit left of the status glyphs (extras/). An app that published its own menus (app-menus/) has
 * them here while one of its windows is focused, in place of File, Edit,
 * and View.
 */

import { useColors } from "@dashi/ui";
import { type Bounds, Svg, Text, View } from "@mirinjs/metal";
import { type ReactNode, useRef } from "react";
import { type AgentStore, useAgents } from "./agents/index.ts";
import { type AppMenuStore, useAppMenus } from "./app-menus/store.ts";
import { type App, appFor } from "./apps.ts";
import type { BatteryMonitor } from "./battery/index.ts";
import { formatClock, useClockPrefs, useMinuteClock } from "./clock.ts";
import { AgentPill } from "./consent.tsx";
import { controlFlags, useFlags } from "./control-center/flags.ts";
import { MOON } from "./control-center/glyphs.ts";
import type { ExtrasStore, MenuBarExtra } from "./extras/index.ts";
import { ExtraItems } from "./extras/view.tsx";
import { batteryGlyph, CONTROL_CENTER, LOGO, networkGlyph, speakerGlyph } from "./glyphs.ts";
import { keepAwake, keepAwakeEntries } from "./inhibit/index.ts";
import { type BarMenuId, barMenus, type MenuController, useMenus } from "./menus/index.ts";
import { batteryEntries, extraEntries } from "./menus/status-menu.ts";
import { RecordingButton } from "./recorder/indicator.tsx";
import type { ScreenRecorder } from "./recorder/recorder.ts";
import type { ScreenCaptureStore } from "./screen-capture.ts";
import { CapturePill } from "./screen-capture.tsx";
import { useSettings } from "./settings-app/hooks.ts";
import type { SettingsStore } from "./settings-app/store.ts";
import { type SystemStore, useSystem } from "./system/store.ts";
import { type ToplevelStore, useToplevels } from "./toplevels.ts";

export { formatClock };

/** A title's pill: padding to click, and the wash behind it while its menu is open. */
function Title({
  id,
  open,
  onOpen,
  onHover,
  children,
}: {
  id: BarMenuId;
  open: boolean;
  onOpen: (x: number) => void;
  onHover: (x: number) => void;
  children: ReactNode;
}) {
  const colors = useColors();
  // Events carry the pill's bounds; the last layout stands in for one that does not.
  const laid = useRef<Bounds | null>(null);
  return (
    <View
      testID={`menu-title:${id}`}
      onLayout={(bounds) => {
        laid.current = bounds;
      }}
      onPress={({ bounds }) => onOpen((bounds ?? laid.current)?.x ?? 0)}
      onHoverChange={(hovered, bounds) => hovered && onHover((bounds ?? laid.current)?.x ?? 0)}
      style={{
        flexDirection: "row",
        alignItems: "center",
        height: 22,
        paddingLeft: 10,
        paddingRight: 10,
        borderRadius: 5,
        backgroundColor: open ? colors.switcherSelection : "#00000000",
      }}
    >
      {children}
    </View>
  );
}

/**
 * One status glyph and the room around it to click. The glyphs sit side by
 * side with no gaps, so every pixel of the area is some item's: the network
 * glyph opens the Wi-Fi page, the rest open Control Center.
 */
function StatusItem({
  testID,
  onPress,
  open = false,
  children,
}: {
  testID: string;
  /** With the item's bounds in the bar, when the event carries them. */
  onPress: (bounds?: Bounds) => void;
  /** Its own menu is open: the item's pill is drawn pressed. */
  open?: boolean;
  children: ReactNode;
}) {
  const colors = useColors();
  return (
    <View
      testID={testID}
      onPress={({ bounds }) => onPress(bounds)}
      style={{
        height: 22,
        paddingLeft: 7,
        paddingRight: 7,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 5,
        backgroundColor: open ? colors.switcherSelection : "#00000000",
      }}
    >
      {children}
    </View>
  );
}

export function MenuBar({
  apps,
  toplevels,
  agents,
  capture,
  recorder,
  system,
  menus,
  appMenus,
  extras,
  batteryMonitor,
  settings,
  output,
  onStopAgent,
  installed,
}: {
  apps: readonly App[];
  toplevels: ToplevelStore;
  agents: AgentStore;
  capture: ScreenCaptureStore;
  /** The screen recorder, for its stop button (recorder/). */
  recorder?: ScreenRecorder;
  system: SystemStore;
  menus: MenuController;
  /** The menus apps published; the focused app's replace File, Edit, and View. */
  appMenus: AppMenuStore;
  /** Tray icons and applets (extras/). */
  extras: ExtrasStore;
  /** The battery's draw and heavy apps, for its menu (battery/). */
  batteryMonitor?: BatteryMonitor;
  /** settings.json: what the status area shows (`menuBar`, set in System Settings). */
  settings: SettingsStore;
  /** The screen this bar is on (an output name); its popovers open there. Absent when the screen is unknown. */
  output?: string;
  onStopAgent: (id: number) => void;
  /** The installed app a window's app id stands for (the Dock's match), for its name. */
  installed?: (appId: string) => App | undefined;
}) {
  const colors = useColors();
  const label = { fontSize: 13, color: colors.text } as const;
  const windows = useToplevels(toplevels);
  const connected = useAgents(agents);
  const { battery, network, volume } = useSystem(system);
  const { menuBar } = useSettings(settings).data;
  // Banners stop while Do Not Disturb is on; the moon says why, as on a Mac.
  const { dnd } = useFlags(controlFlags());
  const { popover: current, appName: frozenName, output: openOn } = useMenus(menus);
  // Only the bar the popover opened from shows it as open.
  const popover = openOn === output ? current : null;
  const now = useMinuteClock();
  const clock = useClockPrefs();
  const active = windows.find((window) => window.activated);
  // An open menu holds the keyboard, which leaves no window active: the name stays as it was.
  const appName = frozenName ?? (active ? appFor(apps, active, installed).name : "Desktop");
  const openMenu = popover?.kind === "menu" ? popover.id : null;
  // Held while a popover is open, like the name (app-menus/store.ts).
  const titles = barMenus(useAppMenus(appMenus));
  const openControlCenter = () => void menus.toggleControlCenter(appName, "main", output);
  const openWifi = () => void menus.toggleControlCenter(appName, "wifi", output);
  const statusMenuKey = popover?.kind === "status-menu" ? popover.key : null;
  const openBattery = (bounds?: Bounds) => {
    if (!battery || !bounds) return;
    // The monitor knows the draw and the heavy apps; without it the menu has the battery alone.
    const use = batteryMonitor?.getSnapshot();
    const entries = batteryEntries(battery, { watts: use?.watts ?? null, apps: use?.significant ?? [] });
    // What keeps the computer awake, above Battery Settings (inhibit/menu.ts).
    entries.splice(-2, 0, ...keepAwakeEntries(keepAwake().awake(), (id) => installed?.(id)?.name ?? id, { kind: "allow-sleep" as const }));
    void menus.toggleStatusMenu("battery", bounds.x + bounds.width, entries, appName, output);
  };
  const openExtraMenu = (extra: MenuBarExtra, right: number) => {
    if (statusMenuKey === extra.key) {
      menus.close();
      return;
    }
    void extras.menu(extra.key).then((rows) => {
      if (rows.length > 0) void menus.toggleStatusMenu(extra.key, right, extraEntries(extra.key, rows), appName, output);
    });
  };
  const menu = (id: BarMenuId, children: ReactNode) => (
    <Title
      key={id}
      id={id}
      open={openMenu === id}
      onOpen={(x) => void menus.toggleMenu(id, x, appName, output)}
      onHover={(x) => menus.hoverMenu(id, x, output)}
    >
      {children}
    </Title>
  );

  return (
    <View
      style={{
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        paddingLeft: 6,
        // The clock's pill has 8 of its own.
        paddingRight: 6,
        position: "relative",
        backgroundColor: colors.menuBar,
      }}
    >
      {/* A hairline, not a shadow: a shadow needs a surface taller than the bar, and that would take clicks from the windows' top edge. */}
      <View testID="menu-bar-edge" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 1, backgroundColor: colors.menuBarEdge }} />
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        {menu("dashi", <Svg markup={LOGO} size={16} color={colors.text} />)}
        {menu("app", <Text style={{ ...label, fontWeight: "bold" }}>{appName}</Text>)}
        {titles.map(({ id, title }) => menu(id, <Text style={label}>{title}</Text>))}
      </View>
      <View style={{ marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: 16, flexShrink: 1, minWidth: 0 }}>
        {recorder ? <RecordingButton recorder={recorder} /> : null}
        <CapturePill store={capture} {...(recorder ? { recorder } : {})} />
        {connected.map((agent) => (
          <AgentPill key={agent.id} agent={agent} onStop={() => onStopAgent(agent.id)} />
        ))}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1, minWidth: 0 }}>
          <ExtraItems store={extras} openKey={statusMenuKey} onMenu={openExtraMenu} onActivate={(extra, x, y) => extras.activate(extra.key, x, y)} />
          <View
            testID="status-area"
            style={{
              flexShrink: 0,
              flexDirection: "row",
              alignItems: "center",
              height: 22,
              borderRadius: 5,
              backgroundColor: popover?.kind === "control-center" ? colors.switcherSelection : "#00000000",
            }}
          >
            {battery && (
              <StatusItem testID="status-battery" onPress={openBattery} open={statusMenuKey === "battery"}>
                {menuBar.batteryPercent === true && (
                  <View testID="status-battery-percent" style={{ marginRight: 5 }}>
                    <Text
                      style={{ fontSize: 12, color: battery.state === "discharging" && battery.percent <= 10 ? colors.batteryLow : colors.text }}
                    >{`${battery.percent}%`}</Text>
                  </View>
                )}
                <Svg
                  markup={batteryGlyph(battery.percent, battery.state === "charging" ? true : battery.state === "discharging" ? false : "plugged")}
                  width={24}
                  height={12}
                  color={battery.state === "discharging" && battery.percent <= 10 ? colors.batteryLow : colors.text}
                />
              </StatusItem>
            )}
            {network && (
              // The network glyph opens Control Center on its Wi-Fi page; a wired connection has none.
              <StatusItem testID="status-network" onPress={network.kind === "wired" ? openControlCenter : openWifi}>
                <Svg markup={networkGlyph(network)} size={15} color={colors.text} />
              </StatusItem>
            )}
            {volume && menuBar.sound !== false && (
              <StatusItem testID="status-volume" onPress={openControlCenter}>
                <Svg markup={speakerGlyph(volume.level, volume.muted)} size={15} color={colors.text} />
              </StatusItem>
            )}
            {dnd && (
              <StatusItem testID="status-dnd" onPress={openControlCenter}>
                <Svg markup={MOON} size={15} color={colors.text} />
              </StatusItem>
            )}
            <StatusItem testID="status-control-center" onPress={openControlCenter}>
              <Svg markup={CONTROL_CENTER} size={15} color={colors.text} />
            </StatusItem>
          </View>
          <View
            testID="clock"
            onPress={() => void menus.toggleNotificationCenter(appName, output)}
            style={{
              flexShrink: 0,
              justifyContent: "center",
              height: 22,
              paddingLeft: 8,
              paddingRight: 8,
              borderRadius: 5,
              backgroundColor: popover?.kind === "notification-center" ? colors.switcherSelection : "#00000000",
            }}
          >
            <Text style={label}>{formatClock(now, clock)}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}
