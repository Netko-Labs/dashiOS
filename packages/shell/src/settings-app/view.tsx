/**
 * The System Settings window: the sidebar of panes on the left, the chosen
 * pane on the right. Everything paints with the live palette.
 *
 * The window has a unified title bar (as System Settings on the Mac): the
 * sidebar runs to the top edge with the compositor's window controls over it,
 * and the header strip over the pane is the window's one chrome row (VS-1):
 * the pane's title, Recently changed's button, and the search field, which
 * is also where the window is grabbed. Typing there lists the panes and rows
 * found in the sidebar's place (find.ts); ↑ ↓ choose, Return opens, Esc
 * clears; ❖F (Edit › Find) comes back to it. Where there is no such
 * compositor the window keeps an ordinary title bar and the strip under it.
 */

import { useColors } from "@dashi/ui";
import { useWindowChrome, View } from "@mirinjs/metal";
import { useMemo, useState, useSyncExternalStore } from "react";
import type { PaneContext } from "./context.ts";
import { type FindFocus, type Found, findSettings, moveFound } from "./find.ts";
import { HEADER, HeaderStrip } from "./header.tsx";
import { useSettings } from "./hooks.ts";
import { AboutPane } from "./panes/about.tsx";
import { AgentsPane } from "./panes/agents.tsx";
import { AppearancePane } from "./panes/appearance.tsx";
import { BatteryPane } from "./panes/battery.tsx";
import { BluetoothPane } from "./panes/bluetooth.tsx";
import { ControlCenterPane } from "./panes/control-center.tsx";
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
import { RecentPane } from "./panes/recent.tsx";
import { SoundPane } from "./panes/sound.tsx";
import { TrackpadPane } from "./panes/trackpad.tsx";
import { UsersPane } from "./panes/users.tsx";
import { WallpaperPane } from "./panes/wallpaper.tsx";
import { type Nav, type PaneId, paneTitle } from "./panes.ts";
import { PaneStoresContext } from "./setting.tsx";
import { Sidebar } from "./sidebar.tsx";
import { SpotContext, type SpotHost } from "./spot.tsx";
import { Group, Note, Page, SaveError, useSurface } from "./ui.tsx";

/**
 * The window's size (the Mac's System Settings opens about this big): tall
 * enough for every sidebar row, Graphics' too, with nothing to scroll
 * (sidebar.tsx `sidebarHeight`); a smaller window scrolls the list.
 */
export const SETTINGS_WINDOW = { width: 760, height: 733 } as const;

function Pane({ id, ctx }: { id: PaneId; ctx: PaneContext }) {
  switch (id) {
    case "appearance":
      return <AppearancePane flags={ctx.flags} settings={ctx.settings} />;
    case "wallpaper":
      return <WallpaperPane settings={ctx.settings} chooser={ctx.chooser} />;
    case "displays":
      return <DisplaysPane screens={ctx.screens} settings={ctx.settings} laptop={ctx.services.laptop} refresh={ctx.services.refresh} />;
    case "control-center":
      return <ControlCenterPane editor={ctx.controlCenter?.() ?? null} />;
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
      return <LockScreenPane settings={ctx.settings} lock={ctx.lock} show={ctx.show} />;
    case "notifications":
      return <NotificationsPane />;
    case "passwords":
      return ctx.passwords ? (
        <PasswordsPane passwords={ctx.passwords} />
      ) : (
        <Page title="Passwords">
          <Group testID="passwords-none">
            <Note>Dashi's vault isn't running in this session, so there are no passwords to show. Log out and in again to start it.</Note>
          </Group>
        </Page>
      );
    case "agents":
      return <AgentsPane ctx={ctx} />;
    case "privacy":
      return (
        <PrivacyPane
          grants={ctx.grants}
          home={ctx.home}
          settings={ctx.settings}
          show={ctx.show}
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
      return <BatteryPane services={ctx.services} settings={ctx.settings} show={ctx.show} />;
    case "graphics":
      return <GraphicsPane laptop={ctx.services.laptop} />;
    case "users":
      return <UsersPane services={ctx.services} chooser={ctx.chooser} />;
    case "recent":
      return <RecentPane changes={ctx.settings.changes} settings={ctx.settings} flags={ctx.flags} show={ctx.show} />;
  }
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
const NO_FIND = { subscribe: () => () => {}, getSnapshot: () => 0 };

/** The header strip's search: what was typed, what it found, and which result ↑ and ↓ are on. */
function useSearch(shown: ReadonlySet<PaneId>, open: (found: Found) => void) {
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState(0);
  const found = useMemo(() => findSettings(query, (pane) => !pane.optional || shown.has(pane.id)), [query, shown]);
  const at = Math.min(chosen, found.length - 1);
  return {
    query,
    found,
    chosen: at,
    onQuery: (next: string) => {
      setQuery(next);
      setChosen(0);
    },
    onKey: (key: "Escape" | "ArrowUp" | "ArrowDown") => {
      if (key === "Escape") setQuery("");
      else setChosen(moveFound(at, key === "ArrowUp" ? -1 : 1, found.length));
    },
    onSubmit: () => {
      const pick = found[at];
      if (pick) open(pick);
    },
    choose: (index: number) => {
      setChosen(index);
      const pick = found[index];
      if (pick) open(pick);
    },
  };
}

export function SettingsWindow({ ctx, nav, spots, find }: { ctx: PaneContext; nav: Nav; spots?: SpotHost; find?: FindFocus }) {
  const colors = useColors();
  const surface = useSurface();
  const current = useSyncExternalStore(nav.subscribe, nav.getSnapshot);
  const { error } = useSettings(ctx.settings);
  const { controls } = useWindowChrome();
  const shown = useOptionalPanes(ctx);
  const focusSerial = useSyncExternalStore(find?.subscribe ?? NO_FIND.subscribe, find?.getSnapshot ?? NO_FIND.getSnapshot);
  // A result opens its pane at its row, lit (spot.tsx).
  const search = useSearch(shown, (found) => {
    nav.select(found.pane);
    if (found.row) spots?.focus.request(found.pane, found.row);
  });
  // The registry's rows read and write these (setting.tsx).
  const stores = useMemo(() => ({ settings: ctx.settings, flags: ctx.flags }), [ctx.settings, ctx.flags]);
  const strip = controls ? Math.ceil(controls.y + controls.height) : HEADER.height;
  const results = search.query.trim() === "" ? null : { query: search.query, found: search.found, chosen: search.chosen, onChoose: search.choose };
  return (
    <PaneStoresContext.Provider value={stores}>
      <SpotContext.Provider value={spots ?? null}>
        <SaveError.Provider value={error !== null}>
          {/* The focus ring is kombu in every control inside (KB-2). */}
          <View testID="settings-window" style={{ flex: 1, flexDirection: "row", backgroundColor: surface.window, focusRingColor: colors.focusRing }}>
            <Sidebar current={current} onSelect={(pane) => nav.select(pane)} shown={shown} {...(results ? { results } : {})} />
            <View style={{ flex: 1, flexDirection: "column", minWidth: 0 }}>
              <HeaderStrip title={paneTitle(current)} height={strip} onRecent={() => nav.select("recent")} search={{ ...search, focusSerial }} />
              {/* A pane's state is its own: switching panes starts the next one fresh. */}
              <Pane key={current} id={current} ctx={ctx} />
            </View>
          </View>
        </SaveError.Provider>
      </SpotContext.Provider>
    </PaneStoresContext.Provider>
  );
}
