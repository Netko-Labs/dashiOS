/**
 * Opens System Settings on demand (the Dashi menu, the launcher, ❖,) and
 * keeps it to one window: asking again brings the window forward instead of
 * opening a second. It runs inside the shell process, like Force Quit, so
 * its panes use the shell's own stores (Dark Mode, Do Not Disturb, the
 * agents' kept answers) directly; what must survive a restart goes to
 * settings.json (store.ts), which the shell applies.
 */

import { homedir } from "node:os";
import type { AnswerStatus } from "../agents/ask/service.ts";
import type { Grants } from "../agents/consent.ts";
import type { Passwords } from "../agents/secrets/passwords.ts";
import { registerShellApp, SETTINGS_APP_ID } from "../apps.ts";
import type { ClipboardHistory } from "../clipboard/history.ts";
import type { Compositor } from "../compositor.ts";
import type { FlagsStore } from "../control-center/flags.ts";
import { type OverlayHandle, openOverlay } from "../overlay.tsx";
import type { PrivacyStore } from "../privacy/store.ts";
import type { RegionStore } from "../region/store.ts";
import { portalChooser } from "../wallpaper/chooser.ts";
import { readAbout } from "./about.ts";
import type { PaneContext } from "./context.ts";
import { type MenuHost, publishEditMenu } from "./edit-menu.ts";
import { loadLayouts } from "./layouts.ts";
import { Nav, type PaneId } from "./panes.ts";
import type { Arranger } from "./screens.ts";
import { ScreensStore } from "./screens.ts";
import type { PaneServices } from "./services.ts";
import { RowFocus, type SpotHost } from "./spot.tsx";
import type { SettingsStore } from "./store.ts";
import { SETTINGS_WINDOW, SettingsWindow } from "./view.tsx";

export interface SettingsApp {
  /**
   * Opens the window, or brings it forward when it is open; `pane` also
   * switches to that pane, and `row` scrolls to that row and lights it up
   * (a `dashi://settings/<pane>/<row>` address: spot.tsx).
   */
  open(pane?: PaneId, row?: string): void;
  close(): void;
}

export interface SettingsAppOptions {
  /** Null without dashi-comp: the window opens, but has no screens to list and cannot be found to raise. */
  compositor: Compositor | null;
  /** The arrangement service (display-config/); null without a compositor. */
  displays?: Arranger | null;
  settings: SettingsStore;
  /** The system time zone, clock sync, and language. */
  region: RegionStore;
  flags: FlagsStore;
  grants: Pick<Grants, "entries" | "remove" | "revoke" | "onChange">;
  /** The apps' permissions (Privacy & Security), followed from login (privacy/). */
  privacy?: Pick<PrivacyStore, "subscribe" | "getSnapshot" | "revoke" | "refresh">;
  /** Dashi's vault and the login sources (Settings › Passwords). */
  passwords?: Passwords;
  /** The launcher's Ask, for Settings › Agents; late-bound (it starts after Settings), so asked for when the window opens. */
  answers?: () => AnswerStatus | null;
  /** The clipboard history (Settings › Keyboard); asked for when the window opens, since it starts after Settings. */
  clipboard?: () => Pick<ClipboardHistory, "subscribe" | "getSnapshot" | "clear"> | null;
  /** The installed app an app id or program stands for (the clipboard's left-out list names and draws it); the catalog is read after Settings starts. */
  installedApp?: (id: string) => { name: string; icon: string } | undefined;
  lock(): void;
  /** Opens the Setup Assistant (About has a button for it). */
  openSetup(): void;

  /** The machine panes' services; asked for when the window opens, since they come from stores made after Settings. */
  services(): PaneServices;
  /** The menu bar's store, for Settings' Edit menu (Undo a setting: edit-menu.ts); asked for when the window opens. */
  menus?(): MenuHost;
}

interface Session {
  surface: OverlayHandle | null;
  stop: () => void;
}

export const SETTINGS_TITLE = "System Settings";

/** The Ask's reads for the panes, when the shell has them by now. */
function answersOf(options: SettingsAppOptions): { answers?: AnswerStatus } {
  const answers = options.answers?.();
  return answers ? { answers } : {};
}

export function startSettingsApp(options: SettingsAppOptions): SettingsApp {
  const { compositor } = options;
  const nav = new Nav();
  const focus = new RowFocus();
  let session: Session | null = null;
  // The page scrolls to a row through the window's host (spot.tsx).
  const spots: SpotHost = { focus, scroll: (testID, dy) => session?.surface?.scroll?.(testID, dy) };

  const close = (): void => {
    const current = session;
    if (!current) return;
    session = null;
    current.stop();
    current.surface?.close();
  };

  /** Raises the window: the compositor lists it by app id, and `focus` brings a minimized or hidden one back too. */
  const raise = async (): Promise<void> => {
    try {
      const window = (await compositor?.windows())?.find((candidate) => candidate.appId === SETTINGS_APP_ID);
      if (window) await compositor?.request("focus", { window: window.id });
    } catch (error) {
      console.error("dashi-shell: could not bring System Settings forward:", error);
    }
  };

  const open = (pane?: PaneId, row?: string): void => {
    if (pane) nav.select(pane);
    else if (!session) nav.reopen();
    if (pane && row) focus.request(pane, row);
    if (session) {
      void raise();
      return;
    }
    const screens = new ScreensStore(compositor, options.settings, options.displays ?? null);
    const clipboard = options.clipboard?.() ?? null;
    const ctx: PaneContext = {
      settings: options.settings,
      region: options.region,
      flags: options.flags,
      screens,
      grants: options.grants,
      ...(options.privacy ? { privacy: options.privacy } : {}),
      ...(options.passwords ? { passwords: options.passwords } : {}),
      ...answersOf(options),
      ...(clipboard ? { clipboard } : {}),
      ...(options.installedApp ? { installedApp: options.installedApp } : {}),
      layouts: loadLayouts(),
      chooser: portalChooser(),
      services: options.services(),
      about: readAbout,
      lock: options.lock,
      openSetup: options.openSetup,
      show: (pane, row) => open(pane, row),
      home: homedir(),
    };
    const stopScreens = screens.start();
    const stopWatching = options.settings.watch();
    const menus = options.menus?.();
    // The window's process, by its app id, once the compositor lists it.
    const stopMenu =
      menus && compositor
        ? publishEditMenu(
            menus,
            options.settings.undo,
            async () => (await compositor.windows()).find((window) => window.appId === SETTINGS_APP_ID)?.pid ?? null,
          )
        : () => {};
    const current: Session = {
      surface: null,
      stop: () => {
        stopScreens();
        stopWatching();
        stopMenu();
      },
    };
    session = current;
    // No `surface`: an ordinary window with the compositor's window controls: over the content (the
    // unified title bar, see view.tsx) where the compositor can draw them so, else in a title bar.
    current.surface = openOverlay(
      { title: SETTINGS_TITLE, appId: SETTINGS_APP_ID, width: SETTINGS_WINDOW.width, height: SETTINGS_WINDOW.height, titleBar: "unified" },
      <SettingsWindow ctx={ctx} nav={nav} spots={spots} />,
      () => {
        // The window went (its close button, or its host died): forget the session.
        if (session === current) session = null;
        current.stop();
      },
    );
  };

  // The launcher and the Dock open Settings through the shell's own-app registry (apps.ts).
  const unregister = registerShellApp(SETTINGS_APP_ID, () => open());

  return {
    open,
    close() {
      unregister();
      close();
    },
  };
}
