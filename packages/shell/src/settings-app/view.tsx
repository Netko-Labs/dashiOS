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

import { useColors } from "@dashi/ui";
import { Text, useWindowChrome, View } from "@mirinjs/metal";
import { useMemo, useSyncExternalStore } from "react";
import type { PaneContext } from "./context.ts";
import { useSettings } from "./hooks.ts";
import { AboutPane } from "./panes/about.tsx";
import { AgentsPane } from "./panes/agents.tsx";
import { AppearancePane } from "./panes/appearance.tsx";
import { BatteryPane } from "./panes/battery.tsx";
import { BluetoothPane } from "./panes/bluetooth.tsx";
import { DateTimePane } from "./panes/date-time.tsx";
import { DesktopDockPane } from "./panes/desktop-dock.tsx";
import { DisplaysPane } from "./panes/displays.tsx";
import { GraphicsPane } from "./panes/graphics.tsx";
import { KeyboardPane } from "./panes/keyboard.tsx";
import { LanguageRegionPane } from "./panes/language-region.tsx";
import { LockScreenPane } from "./panes/lock-screen.tsx";
import { MousePane } from "./panes/mouse.tsx";
import { NetworkPane } from "./panes/network.tsx";
import { NotificationsPane } from "./panes/notifications.tsx";
import { PasswordsPane } from "./panes/passwords.tsx";
import { PrivacyPane } from "./panes/privacy.tsx";
import { SoundPane } from "./panes/sound.tsx";
import { TrackpadPane } from "./panes/trackpad.tsx";
import { UsersPane } from "./panes/users.tsx";
import { WallpaperPane } from "./panes/wallpaper.tsx";
import { type Nav, type PaneId, paneTitle } from "./panes.ts";
import { PaneStoresContext } from "./setting.tsx";
import { Sidebar } from "./sidebar.tsx";
import { SpotContext, type SpotHost } from "./spot.tsx";
import { useSurface } from "./ui.tsx";

/** The window's size (the Mac's System Settings opens about this big). */
export const SETTINGS_WINDOW = { width: 760, height: 640 } as const;

function Pane({ id, ctx }: { id: PaneId; ctx: PaneContext }) {
  switch (id) {
    case "appearance":
      return <AppearancePane flags={ctx.flags} settings={ctx.settings} />;
    case "wallpaper":
      return <WallpaperPane settings={ctx.settings} chooser={ctx.chooser} />;
    case "displays":
      return <DisplaysPane screens={ctx.screens} settings={ctx.settings} laptop={ctx.services.laptop} />;
    case "desktop-dock":
      return <DesktopDockPane />;
    case "keyboard":
      return (
        <KeyboardPane
          settings={ctx.settings}
          layouts={ctx.layouts}
          laptop={ctx.services.laptop}
          clipboard={ctx.clipboard ?? null}
          {...(ctx.installedApp ? { installed: ctx.installedApp } : {})}
        />
      );
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
      return <NotificationsPane />;
    case "passwords":
      return ctx.passwords ? <PasswordsPane passwords={ctx.passwords} /> : null;
    case "agents":
      return <AgentsPane settings={ctx.settings} show={ctx.show} {...(ctx.answers ? { answers: ctx.answers } : {})} />;
    case "privacy":
      return (
        <PrivacyPane
          grants={ctx.grants}
          home={ctx.home}
          settings={ctx.settings}
          {...(ctx.privacy ? { privacy: ctx.privacy } : {})}
          {...(ctx.installedApp ? { installedApp: ctx.installedApp } : {})}
        />
      );
    case "about":
      return <AboutPane about={ctx.about} openSetup={ctx.openSetup} />;
    case "network":
      return <NetworkPane services={ctx.services} />;
    case "bluetooth":
      return <BluetoothPane services={ctx.services} />;
    case "sound":
      return <SoundPane services={ctx.services} />;
    case "battery":
      return <BatteryPane services={ctx.services} settings={ctx.settings} />;
    case "graphics":
      return <GraphicsPane laptop={ctx.services.laptop} />;
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

const NO_GRAPHICS = { subscribe: () => () => {}, getSnapshot: () => false };

/** The panes listed only when the machine has them: Graphics with a graphics card. */
function useOptionalPanes(ctx: PaneContext): ReadonlySet<PaneId> {
  const graphics = ctx.services.laptop?.graphics;
  const source = graphics ? { subscribe: graphics.subscribe, getSnapshot: () => graphics.getSnapshot().hasCard } : NO_GRAPHICS;
  const hasCard = useSyncExternalStore(source.subscribe, source.getSnapshot);
  return hasCard ? GRAPHICS_PANES : NONE;
}
const GRAPHICS_PANES: ReadonlySet<PaneId> = new Set(["graphics"]);
const NONE: ReadonlySet<PaneId> = new Set();

export function SettingsWindow({ ctx, nav, spots }: { ctx: PaneContext; nav: Nav; spots?: SpotHost }) {
  const colors = useColors();
  const surface = useSurface();
  const current = useSyncExternalStore(nav.subscribe, nav.getSnapshot);
  const { error } = useSettings(ctx.settings);
  const { controls } = useWindowChrome();
  const shown = useOptionalPanes(ctx);
  // The registry's rows read and write these (setting.tsx).
  const stores = useMemo(() => ({ settings: ctx.settings, flags: ctx.flags }), [ctx.settings, ctx.flags]);
  return (
    <PaneStoresContext.Provider value={stores}>
      <SpotContext.Provider value={spots ?? null}>
        {/* The focus ring is kombu in every control inside (KB-2). */}
        <View testID="settings-window" style={{ flex: 1, flexDirection: "row", backgroundColor: surface.window, focusRingColor: colors.focusRing }}>
          <Sidebar current={current} onSelect={(pane) => nav.select(pane)} shown={shown} />
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
      </SpotContext.Provider>
    </PaneStoresContext.Provider>
  );
}
