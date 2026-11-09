/**
 * The menu bar: the Dashi menu and the focused app's name and menus on the
 * left, status and the clock on the right. A click opens a title's menu (the
 * pointer then moves between menus without clicking), a click on the status
 * area opens Control Center (the battery has its own panel), and a click on
 * the clock the notification center (menus/). Programs' own items, tray
 * icons and applets, sit left of the status glyphs (extras/), then the agent
 * mark (agent-mark.tsx), the person's own recording, and the microphone
 * while an app records from it (sound/mic-pill.tsx). An app that
 * published its own menus (app-menus/) has them here while one of its
 * windows is focused, in place of File, Edit, and View. The bar is one row:
 * when the status side runs out of room, its items go into "…"
 * (menubar-status.tsx), never the menus.
 */

import { useColors } from "@dashi/ui";
import { type Bounds, Svg, Text, View } from "@mirinjs/metal";
import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AgentMark } from "./agent-mark.tsx";
import type { AgentRuns } from "./agents/handoff/store.ts";
import { type AgentStore, useAgents } from "./agents/index.ts";
import { agentRecording, markState, mergeAgents, type Recording, recordingPill } from "./agents/mark.ts";
import { useRuns } from "./agents-panel.tsx";
import { type AppMenuStore, useAppMenus } from "./app-menus/store.ts";
import { type App, appFor } from "./apps.ts";
import { barHold, useBarHeld } from "./bar-hold.ts";
import { type BarName, barName, DESKTOP } from "./bar-name.ts";
import { formatClock, useClockPrefs, useMinuteClock } from "./clock.ts";
import { controlFlags, useFlags } from "./control-center/flags.ts";
import { type ExtrasStore, type MenuBarExtra, useExtras } from "./extras/index.ts";
import { ExtraItem } from "./extras/view.tsx";
import { LOGO } from "./glyphs.ts";
import { extraGoes, statusRoom } from "./menubar-fit.ts";
import { systemSlots } from "./menubar-slots.tsx";
import { BarRing, StatusSide, type StatusSlot } from "./menubar-status.tsx";
import { type BarStop, titleStop } from "./menus/bar-keys.ts";
import { type BarMenuId, barMenus, type MenuController, useMenus } from "./menus/index.ts";
import { extraEntries } from "./menus/status-menu.ts";
import { RecordingButton } from "./recorder/indicator.tsx";
import type { ScreenRecorder } from "./recorder/recorder.ts";
import { type ScreenCaptureStore, useScreenCapture } from "./screen-capture.ts";
import { CapturePill } from "./screen-capture.tsx";
import { useSettings } from "./settings-app/hooks.ts";
import type { SettingsStore } from "./settings-app/store.ts";
import { type AppMixer, useMicWords } from "./sound/apps/index.ts";
import { MicPill } from "./sound/mic-pill.tsx";
import { type SystemStore, useSystem } from "./system/store.ts";
import { type ToplevelStore, usePortalDialogs, useToplevels } from "./toplevels.ts";

export { formatClock };

/** A title's pill: padding to click, the wash behind it while its menu is open, and the keyboard's ring (menus/bar-keys.ts). */
function Title({
  id,
  open,
  focused,
  label,
  onOpen,
  onHover,
  onBounds,
  children,
}: {
  id: BarMenuId;
  open: boolean;
  focused: boolean;
  /** Its name for a screen reader, on a host that takes accessibility props. */
  label?: string;
  onOpen: (x: number) => void;
  onHover: (x: number) => void;
  /** Where it is drawn, for opening it from the keyboard. */
  onBounds: (bounds: Bounds) => void;
  children: ReactNode;
}) {
  const colors = useColors();
  // Events carry the pill's bounds; the last layout stands in for one that does not.
  const laid = useRef<Bounds | null>(null);
  return (
    <View
      testID={`menu-title:${id}`}
      {...(label === undefined ? {} : { accessibilityRole: "button" as const, accessibilityLabel: label, accessibilityState: { expanded: open } })}
      onLayout={(bounds) => {
        laid.current = bounds;
        onBounds(bounds);
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
        position: "relative",
        backgroundColor: open ? colors.switcherSelection : "#00000000",
      }}
    >
      {children}
      {focused && <BarRing radius={5} />}
    </View>
  );
}

const IDLE: Recording = { kind: "idle" };
const NEVER = () => () => {};
const NO_RUNS = { subscribe: NEVER, getSnapshot: () => [] } as const;

/** The recorder's state, or idle without one. */
function useRecording(recorder: ScreenRecorder | undefined): Recording {
  return useSyncExternalStore(recorder?.subscribe ?? NEVER, recorder ? recorder.getSnapshot : () => IDLE);
}

/** The bar's tooltip (bar-tip.tsx): words under a point of this bar (as wide as `barWidth`), or none. */
export type BarTip = { text: string; x: number; barWidth?: number; output?: string } | null;

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
  settings,
  output,
  runs,
  installed,
  mixer,
  onTip,
  reduceMotion = () => false,
  accessible = () => false,
}: {
  apps: readonly App[];
  toplevels: ToplevelStore;
  agents: AgentStore;
  capture: ScreenCaptureStore;
  /** The screen recorder: the person's recording's stop button (recorder/), an agent's red dot. */
  recorder?: ScreenRecorder;
  system: SystemStore;
  menus: MenuController;
  /** The menus apps published; the focused app's replace File, Edit, and View. */
  appMenus: AppMenuStore;
  /** Tray icons and applets (extras/). */
  extras: ExtrasStore;
  /** settings.json: what the status area shows (`menuBar`, set in System Settings). */
  settings: SettingsStore;
  /** The screen this bar is on (an output name); its popovers open there. Absent when the screen is unknown. */
  output?: string;
  /** Agents from the launcher: with the connected ones, the mark and its panel (agents-panel.tsx). */
  runs?: Pick<AgentRuns, "subscribe" | "getSnapshot">;
  /** The installed app a window's app id stands for (the Dock's match), for its name. */
  installed?: (appId: string) => App | undefined;
  /** The apps' sound: the microphone indicator while one records (sound/apps/). */
  mixer?: AppMixer;
  /** Show or take down the bar's tooltip (the agent mark's words). */
  onTip?: (tip: BarTip) => void;
  /** Reduce Motion: the mark's ring stands still. */
  reduceMotion?: () => boolean;
  /** The Metal host takes accessibility props (launcher/access.ts). */
  accessible?: () => boolean;
}) {
  const colors = useColors();
  const label = { fontSize: 13, color: colors.text } as const;
  const windows = useToplevels(toplevels);
  const connected = useAgents(agents);
  const launched = useRuns(runs ?? NO_RUNS);
  const recording = useRecording(recorder);
  // Someone shares the screen, and it isn't Dashi's own recorder (the pill decides that itself).
  const capturing = useScreenCapture(capture) && recording.kind === "idle";
  const allExtras = useExtras(extras);
  const micWords = useMicWords(mixer);
  const { battery, network, volume } = useSystem(system);
  const { menuBar } = useSettings(settings).data;
  // Banners stop while Do Not Disturb is on; the moon says why, as on a Mac.
  const { dnd } = useFlags(controlFlags());
  const { popover: current, appName: frozenName, output: openOn, bar: ring } = useMenus(menus);
  // Only the bar the popover opened from shows it as open, and the keyboard's ring.
  const popover = openOn === output ? current : null;
  const focused = openOn === output ? (ring ?? null) : null;
  // Where the titles are drawn, and the status side's stops, for the keyboard (menus/bar-keys.ts).
  const titleBounds = useRef(new Map<BarMenuId, Bounds>());
  const statusStops = useRef<BarStop[]>([]);
  const now = useMinuteClock();
  const clock = useClockPrefs();
  // The room the menus leave the status side: the bar's width and the menus' (both measured).
  const [barWidth, setBarWidth] = useState<number | null>(null);
  const [menusWidth, setMenusWidth] = useState<number | null>(null);
  const active = windows.find((window) => window.activated);
  // A portal dialog with the keyboard is named for the app it is over, or by its title (bar-name.ts).
  const dialog = usePortalDialogs(toplevels).find((window) => window.activated);
  // An open menu holds the keyboard, which leaves no window active: the name stays as it was.
  // So does a shell sheet that took the keyboard for the app in front (bar-hold.ts).
  const sheetUp = useBarHeld(barHold);
  const kept = useRef<BarName>({ name: DESKTOP });
  if (!sheetUp && frozenName === null) {
    const focus = { ...(active ? { app: appFor(apps, active, installed).name } : {}), ...(dialog ? { dialog: dialog.title } : {}) };
    kept.current = barName(focus, kept.current, Date.now());
  }
  const appName = frozenName ?? kept.current.name;
  const openMenu = popover?.kind === "menu" ? popover.id : null;
  // Held while a popover is open, like the name (app-menus/store.ts).
  const titles = barMenus(useAppMenus(appMenus));
  const openControlCenter = () => void menus.toggleControlCenter(appName, "main", output);
  const openWifi = () => void menus.toggleControlCenter(appName, "wifi", output);
  const openSound = () => void menus.toggleControlCenter(appName, "sound", output);
  const statusMenuKey = popover?.kind === "status-menu" ? popover.key : null;
  const openBattery = (bounds?: Bounds) => {
    if (!battery || !bounds) return;
    // The battery panel (battery/panel.tsx) under the item, its right edge at the item's.
    void menus.toggleBattery(bounds.x + bounds.width, appName, output);
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
  const labelOf = (id: BarMenuId): string => (id === "dashi" ? "Dashi" : id === "app" ? appName : (titles.find((title) => title.id === id)?.title ?? id));
  const menu = (id: BarMenuId, children: ReactNode) => (
    <Title
      key={id}
      id={id}
      open={openMenu === id}
      focused={focused === titleStop(id)}
      {...(accessible() && id === "dashi" ? { label: labelOf(id) } : {})}
      onOpen={(x) => void menus.toggleMenu(id, x, appName, output)}
      onHover={(x) => menus.hoverMenu(id, x, output)}
      onBounds={(bounds) => titleBounds.current.set(id, bounds)}
    >
      {children}
    </Title>
  );
  const menuIds: BarMenuId[] = ["dashi", "app", ...titles.map((title) => title.id)];
  // The bar's stops for the keyboard, after each draw: its titles, then the status side's (StatusSide's `onStops` comes first).
  useEffect(() => {
    const titleStops = menuIds.map(
      (id): BarStop => ({
        key: titleStop(id),
        label: labelOf(id),
        kind: "menu",
        open: () => void menus.toggleMenu(id, titleBounds.current.get(id)?.x ?? 0, appName, output),
      }),
    );
    menus.setBar(output, { appName, stops: [...titleStops, ...statusStops.current] });
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, when this bar goes.
  useEffect(() => () => menus.dropBar(output), []);

  // Every agent, launched or connected, is one mark; an agent's recording is its red dot.
  const mark = markState(mergeAgents(connected, launched), agentRecording(recording));
  const tip = (shown: { text: string; bounds: Bounds } | null) =>
    onTip?.(
      shown
        ? {
            text: shown.text,
            x: shown.bounds.x + shown.bounds.width / 2,
            ...(barWidth === null ? {} : { barWidth }),
            ...(output === undefined ? {} : { output }),
          }
        : null,
    );
  const slots: StatusSlot[] = [
    ...allExtras.map((extra, index) => ({
      key: `extra:${extra.key}`,
      goes: extraGoes(index),
      extra: true,
      attention: extra.attention,
      label: extra.title,
      // As a click does: its menu under it, or the app's own answer (it leaves the bar).
      open: extra.menuOnClick
        ? { kind: "panel" as const, run: (bounds: Bounds | null) => openExtraMenu(extra, bounds ? bounds.x + bounds.width : 0) }
        : {
            kind: "action" as const,
            run: (bounds: Bounds | null) => extras.activate(extra.key, bounds ? bounds.x + bounds.width / 2 : 0, bounds ? bounds.y + bounds.height : 0, output),
          },
      node: (
        <ExtraItem
          extra={extra}
          open={statusMenuKey === extra.key}
          onMenu={openExtraMenu}
          onActivate={(each, x, y) => extras.activate(each.key, x, y, output)}
          accessible={accessible()}
        />
      ),
    })),
    // Never hidden: someone else sharing the screen, every agent, the person's own recording.
    ...(capturing ? [{ key: "capture", goes: null, node: <CapturePill store={capture} {...(recorder ? { recorder } : {})} /> }] : []),
    ...(mark.kind === "none"
      ? []
      : [
          {
            key: "agent-mark",
            goes: null,
            label: mark.label,
            radius: 11,
            open: {
              kind: "panel" as const,
              run: (bounds: Bounds | null) => void menus.toggleAgents(appName, bounds ? bounds.x + bounds.width : 0, null, output),
            },
            node: (
              <AgentMark
                state={mark}
                open={popover?.kind === "agents"}
                onPress={(right) => void menus.toggleAgents(appName, right, null, output)}
                onTip={tip}
                reduceMotion={reduceMotion}
                accessible={accessible()}
              />
            ),
          },
        ]),
    ...(recorder && recordingPill(recording, mark.kind !== "none")
      ? [
          {
            key: "recording",
            goes: null,
            label: "Stop recording",
            radius: 10,
            open: { kind: "action" as const, run: () => void recorder.stop() },
            node: <RecordingButton recorder={recorder} />,
          },
        ]
      : []),
    // Never hidden either: an app using the microphone.
    ...(micWords !== ""
      ? [
          {
            key: "microphone",
            goes: null,
            label: micWords,
            radius: 10,
            open: { kind: "action" as const, run: openSound },
            node: <MicPill words={micWords} onPress={openSound} onTip={tip} />,
          },
        ]
      : []),
    ...systemSlots({
      ...{ battery, network, volume },
      batteryPercent: menuBar.batteryPercent === true,
      sound: menuBar.sound !== false,
      dnd,
      popover,
      clock: formatClock(now, clock),
      colors,
      accessible: accessible(),
      on: {
        battery: openBattery,
        controlCenter: openControlCenter,
        wifi: openWifi,
        sound: openSound,
        clock: () => void menus.toggleNotificationCenter(appName, output),
      },
    }),
  ];

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
      {/* It spans the bar, so it says the bar's width too (Metal reports a root's children's layout, not the root's). */}
      <View
        testID="menu-bar-edge"
        onLayout={(bounds) => setBarWidth(bounds.width)}
        style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 1, backgroundColor: colors.menuBarEdge }}
      />
      {/* The app's menus never give way: the status side does (menubar-fit.ts). */}
      <View testID="menu-titles" onLayout={(bounds) => setMenusWidth(bounds.width)} style={{ flexDirection: "row", alignItems: "center", flexShrink: 0 }}>
        {menu("dashi", <Svg markup={LOGO} size={16} color={colors.text} />)}
        {menu(
          "app",
          <Text numberOfLines={1} style={{ ...label, fontWeight: "bold" }}>
            {appName}
          </Text>,
        )}
        {titles.map(({ id, title }) =>
          menu(
            id,
            <Text numberOfLines={1} style={label}>
              {title}
            </Text>,
          ),
        )}
      </View>
      <StatusSide
        slots={slots}
        room={barWidth === null || menusWidth === null ? null : statusRoom(barWidth, menusWidth, 12)}
        areaOpen={popover?.kind === "control-center"}
        moreOpen={popover?.kind === "overflow"}
        onMore={(right, hidden) => void menus.toggleOverflow(appName, right, hidden, output)}
        onHidden={(hidden) => {
          if (popover?.kind === "overflow") menus.setOverflow(hidden);
        }}
        focused={focused}
        onStops={(stops) => {
          statusStops.current = stops;
        }}
        accessible={accessible()}
      />
    </View>
  );
}
