/**
 * The System Settings window (docs/design.html, "Settings"): the sidebar of
 * panes on the left, the chosen pane on the right, in Control Center's
 * tokens. One chrome row: the compositor's window lights and the search
 * field sit on the sidebar's top row, and the pane's title is the content's
 * own top row; no toolbar, no second bar. Typing in the search lists the
 * panes and rows found in the sidebar's place (find.ts); ↑ ↓ choose, Return
 * opens the pane at the row and lights it, Esc clears; ❖F (Edit › Find)
 * comes back to it.
 */

import { TooltipLayer } from "@dashi/ui";
import { View } from "@mirinjs/metal";
import { useMemo, useState, useSyncExternalStore } from "react";
import { waitingCount } from "../agents/presence.ts";
import { INK_SLIDER } from "../shared/controls/ink-slider.tsx";
import { useControlColors } from "../shared/controls/palette.ts";
import type { PaneContext } from "./context.ts";
import { type FindFocus, type Found, findSettings, moveFound } from "./find.ts";
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
import type { Nav, PaneId } from "./panes.ts";
import { PAGE } from "./row.tsx";
import { PaneStoresContext } from "./setting.tsx";
import { SIDEBAR, Sidebar } from "./sidebar.tsx";
import { SpotContext, type SpotHost } from "./spot.tsx";
import { Group, Note, Page, SaveError } from "./ui.tsx";

/**
 * The widest row that can't fold: a knob, its words at their least
 * (`PAGE.words`) and a slider beside them (Mouse's and Trackpad's speeds,
 * Keyboard's repeat). Pills wrap and stacked controls sit under the words,
 * so every other row fits in it.
 */
const WIDEST_ROW = 8 + PAGE.knob + 12 + PAGE.words + 12 + INK_SLIDER.width + 16;

/**
 * The window's size: the design's height (640), and wide enough for its
 * rows (a knob, the words, and four pills of the power mode) beside the
 * 232 sidebar. The sidebar scrolls in it, with the chosen pane kept in view.
 *
 * Its least size is where the sidebar and every pane still work: across,
 * the sidebar, the page's margins and the widest row (744); down, the title row,
 * the tallest hero (Displays', 207) and the page's bottom margin (285),
 * rounded up to 300. A page taller than the window scrolls.
 */
export const SETTINGS_WINDOW = {
  width: 920,
  height: 640,
  minWidth: SIDEBAR.width + 2 * PAGE.margin + WIDEST_ROW,
  minHeight: 300,
} as const;

function Pane({ id, ctx }: { id: PaneId; ctx: PaneContext }) {
  switch (id) {
    case "appearance":
      return <AppearancePane flags={ctx.flags} settings={ctx.settings} />;
    case "wallpaper":
      return <WallpaperPane settings={ctx.settings} chooser={ctx.chooser} />;
    case "displays":
      return (
        <DisplaysPane
          screens={ctx.screens}
          settings={ctx.settings}
          laptop={ctx.services.laptop}
          refresh={ctx.services.refresh}
          devices={ctx.services.devices}
        />
      );
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
const NO_AGENT_LIST: readonly { status: string }[] = [];
const NO_AGENTS = { subscribe: () => () => {}, getSnapshot: () => NO_AGENT_LIST };

/** The sidebar's search: what was typed, what it found, and which result ↑ and ↓ are on. */
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
  const colors = useControlColors();
  const current = useSyncExternalStore(nav.subscribe, nav.getSnapshot);
  const { error } = useSettings(ctx.settings);
  const shown = useOptionalPanes(ctx);
  const focusSerial = useSyncExternalStore(find?.subscribe ?? NO_FIND.subscribe, find?.getSnapshot ?? NO_FIND.getSnapshot);
  const agents = useSyncExternalStore(ctx.agents?.subscribe ?? NO_AGENTS.subscribe, ctx.agents?.getSnapshot ?? NO_AGENTS.getSnapshot);
  // A result opens its pane at its row, lit (spot.tsx).
  const search = useSearch(shown, (found) => {
    nav.select(found.pane);
    if (found.row) spots?.focus.request(found.pane, found.row);
  });
  // The registry's rows read and write these (setting.tsx).
  const stores = useMemo(() => ({ settings: ctx.settings, flags: ctx.flags }), [ctx.settings, ctx.flags]);
  const results = search.query.trim() === "" ? null : { query: search.query, found: search.found, chosen: search.chosen, onChoose: search.choose };
  return (
    <PaneStoresContext.Provider value={stores}>
      <SpotContext.Provider value={spots ?? null}>
        <SaveError.Provider value={error !== null}>
          {/* The focus ring is Control Center's purple in every control inside. Esc that no control took clears the search. */}
          <View
            testID="settings-window"
            onWindowKeyDown={(event) => {
              if (event.key === "escape" && search.query !== "") search.onQuery("");
            }}
            style={{ flex: 1, flexDirection: "row", position: "relative", backgroundColor: colors.window, focusRingColor: colors.focus }}
          >
            {/* The window's top layer (as AppWindow's): a row's "More…" menu draws there, over the cards (shared/controls/folded.tsx). */}
            <TooltipLayer>
              <Sidebar
                current={current}
                onSelect={(pane) => nav.select(pane)}
                shown={shown}
                search={{ ...search, focusSerial }}
                waiting={waitingCount(agents)}
                {...(results ? { results } : {})}
              />
              <View style={{ flex: 1, flexDirection: "column", minWidth: 0 }}>
                {/* A pane's state is its own: switching panes starts the next one fresh. */}
                <Pane key={current} id={current} ctx={ctx} />
              </View>
            </TooltipLayer>
          </View>
        </SaveError.Provider>
      </SpotContext.Provider>
    </PaneStoresContext.Provider>
  );
}
