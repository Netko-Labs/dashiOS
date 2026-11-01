/**
 * The System Settings window: the sidebar of panes on the left, the chosen
 * pane on the right, and a line at the bottom when the settings file could
 * not be written. Everything paints with the live palette.
 *
 * The window has a unified title bar (as System Settings on the Mac): the
 * sidebar runs to the top edge with the compositor's window controls over it,
 * and the pane's title sits in a toolbar over the pane, which is also where
 * the window is grabbed. Where there is no such compositor the window keeps
 * an ordinary title bar and each page shows its own heading (ui.tsx).
 */

import { Text, useWindowChrome, View } from "@mirinjs/metal";
import { useSyncExternalStore } from "react";
import { useColors } from "@dashi/ui";
import type { PaneContext } from "./context.ts";
import { useSettings } from "./hooks.ts";
import { AboutPane } from "./panes/about.tsx";
import { AgentsPane } from "./panes/agents.tsx";
import { AppearancePane } from "./panes/appearance.tsx";
import { BatteryPane } from "./panes/battery.tsx";
import { BluetoothPane } from "./panes/bluetooth.tsx";
import { NetworkPane } from "./panes/network.tsx";
import { SoundPane } from "./panes/sound.tsx";
import { UsersPane } from "./panes/users.tsx";
import { DateTimePane } from "./panes/date-time.tsx";
import { DesktopDockPane } from "./panes/desktop-dock.tsx";
import { DisplaysPane } from "./panes/displays.tsx";
import { KeyboardPane } from "./panes/keyboard.tsx";
import { LanguageRegionPane } from "./panes/language-region.tsx";
import { LockScreenPane } from "./panes/lock-screen.tsx";
import { MousePane } from "./panes/mouse.tsx";
import { NotificationsPane } from "./panes/notifications.tsx";
import { TrackpadPane } from "./panes/trackpad.tsx";
import { WallpaperPane } from "./panes/wallpaper.tsx";
import { type Nav, type PaneId, paneTitle } from "./panes.ts";
import { Sidebar } from "./sidebar.tsx";
import { useSurface } from "./ui.tsx";

/** The window's size (the Mac's System Settings opens about this big). */
export const SETTINGS_WINDOW = { width: 760, height: 640 } as const;

function Pane({ id, ctx }: { id: PaneId; ctx: PaneContext }) {
  switch (id) {
    case "appearance":
      return <AppearancePane flags={ctx.flags} settings={ctx.settings} />;
    case "wallpaper":
      return <WallpaperPane settings={ctx.settings} chooser={ctx.chooser} home={ctx.home} />;
    case "displays":
      return <DisplaysPane screens={ctx.screens} settings={ctx.settings} flags={ctx.flags} />;
    case "desktop-dock":
      return <DesktopDockPane settings={ctx.settings} />;
    case "keyboard":
      return <KeyboardPane settings={ctx.settings} layouts={ctx.layouts} />;
    case "trackpad":
      return <TrackpadPane settings={ctx.settings} />;
    case "mouse":
      return <MousePane settings={ctx.settings} />;
    case "date-time":
      return <DateTimePane region={ctx.region} settings={ctx.settings} />;
    case "language-region":
      return <LanguageRegionPane region={ctx.region} settings={ctx.settings} />;
    case "lock-screen":
      return <LockScreenPane settings={ctx.settings} lock={ctx.lock} />;
    case "notifications":
      return <NotificationsPane flags={ctx.flags} />;
    case "agents":
      return <AgentsPane grants={ctx.grants} home={ctx.home} />;
    case "about":
      return <AboutPane about={ctx.about} openSetup={ctx.openSetup} />;
    case "network":
      return <NetworkPane services={ctx.services} />;
    case "bluetooth":
      return <BluetoothPane services={ctx.services} />;
    case "sound":
      return <SoundPane services={ctx.services} settings={ctx.settings} />;
    case "battery":
      return <BatteryPane services={ctx.services} settings={ctx.settings} />;
    case "users":
      return <UsersPane services={ctx.services} chooser={ctx.chooser} />;
  }
}

/** The pane's title in the strip the window controls are centered on, which moves the window. */
function Toolbar({ title, height }: { title: string; height: number }) {
  const colors = useColors();
  return (
    <View testID="settings-toolbar" dragRegion style={{ height, flexShrink: 0, flexDirection: "row", alignItems: "center", paddingHorizontal: 24 }}>
      <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: "bold", color: colors.text }}>
        {title}
      </Text>
    </View>
  );
}

export function SettingsWindow({ ctx, nav }: { ctx: PaneContext; nav: Nav }) {
  const colors = useColors();
  const surface = useSurface();
  const current = useSyncExternalStore(nav.subscribe, nav.getSnapshot);
  const { error } = useSettings(ctx.settings);
  const { controls } = useWindowChrome();
  return (
    <View style={{ flex: 1, flexDirection: "row", backgroundColor: surface.window }}>
      <Sidebar current={current} onSelect={(pane) => nav.select(pane)} />
      <View style={{ flex: 1, flexDirection: "column", minWidth: 0 }}>
        {controls && <Toolbar title={paneTitle(current)} height={Math.ceil(controls.y + controls.height)} />}
        {/* A pane's state is its own: switching panes starts the next one fresh. */}
        <Pane key={current} id={current} ctx={ctx} />
        {error !== null && (
          <View testID="settings-error" style={{ padding: 10, borderTopWidth: 1, borderColor: colors.separator }}>
            <Text numberOfLines={1} style={{ fontSize: 11, color: colors.critical }}>
              {`Could not save settings: ${error}`}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}
