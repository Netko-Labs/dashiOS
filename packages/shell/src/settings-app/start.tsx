/**
 * Opens System Settings on demand (the Dashi menu, the launcher, ❖,) and
 * keeps it to one window: asking again brings the window forward instead of
 * opening a second. It runs inside the shell process, like Force Quit, so
 * its panes use the shell's own stores (Dark Mode, Do Not Disturb, the
 * agents' kept answers) directly; what must survive a restart goes to
 * settings.json (store.ts), which the shell applies.
 */

import { homedir } from "node:os";
import type { AgentStore, AnswerStatus, Grants, Passwords } from "../agents/index.ts";
import { registerShellApp, SETTINGS_APP_ID } from "../apps.ts";
import type { ClipboardHistory } from "../clipboard/history.ts";
import type { Compositor } from "../compositor/index.ts";
import { type OverlayHandle, openOverlay } from "../overlay.tsx";
import type { PrivacyStore } from "../privacy/index.ts";
import type { RegionStore } from "../region/index.ts";
import type { Flags, FlagsStore } from "../shared/control-center/flags.ts";
import { onWindowTyping } from "../shared/metal/typing.ts";
import { Nav, type PaneId } from "../shared/settings/panes.ts";
import { portalChooser } from "../wallpaper/chooser.ts";
import type { AheadSites, PaneContext } from "./context.ts";
import type { ControlCenterEditor } from "./control-center.tsx";
import { loadLayouts } from "./layouts.ts";
import { readAbout } from "./lib/about.ts";
import { type MenuHost, publishEditMenu } from "./lib/edit-menu.ts";
import { FindFocus } from "./lib/find.ts";
import type { Arranger } from "./lib/screens.ts";
import { ScreensStore } from "./lib/screens.ts";
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
  /** Control Center's stores and layout, for its editor (Settings › Control Center). */
  controlCenter?: () => ControlCenterEditor | null;
  /** Null without dashi-comp: the window opens, but has no screens to list and cannot be found to raise. */
  compositor: Compositor | null;
  /** The arrangement service (display-config/); null without a compositor. */
  displays?: Arranger | null;
  settings: SettingsStore;
  /** The system time zone, clock sync, and language. */
  region: RegionStore;
  flags: FlagsStore;
  grants: Pick<Grants, "entries" | "remove" | "revoke" | "restore" | "onChange">;
  /** The sites agents may use without asking (Settings › Agents). */
  sites?: AheadSites;
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
  /** The agents connected now (the menu bar's list), so Settings › Agents can say which. */
  agents?: Pick<AgentStore, "subscribe" | "getSnapshot">;
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

/** Control Center's switches, by name, as Undo in Recently changed writes them back. */
const FLAG_NAMES: readonly (keyof Flags)[] = ["dark", "dnd", "night"];
const isFlag = (field: string): field is keyof Flags => FLAG_NAMES.some((name) => name === field);

/** A switch an agent or a pane turned through the registry is undone through the same store (changes/). */
function attachFlagUndo(options: SettingsAppOptions): void {
  options.settings.changes.attach("flags", {
    read: (field) => (isFlag(field) ? options.flags.getSnapshot()[field] : undefined),
    write: (field, value) => {
      if (isFlag(field)) options.flags.set({ [field]: value === true });
    },
  });
}

/** What the panes are given when the window opens: the stores, and the late-bound parts asked for now. */
function paneContext(
  options: SettingsAppOptions,
  screens: ScreensStore,
  clipboard: ReturnType<NonNullable<SettingsAppOptions["clipboard"]>>,
  open: (pane?: PaneId, row?: string) => void,
): PaneContext {
  return {
    settings: options.settings,
    region: options.region,
    flags: options.flags,
    screens,
    grants: options.grants,
    ...(options.sites ? { sites: options.sites } : {}),
    ...(options.privacy ? { privacy: options.privacy } : {}),
    ...(options.passwords ? { passwords: options.passwords } : {}),
    ...answersOf(options),
    ...(clipboard ? { clipboard } : {}),
    ...(options.installedApp ? { installedApp: options.installedApp } : {}),
    layouts: loadLayouts(),
    chooser: portalChooser(),
    services: options.services(),
    ...(options.controlCenter ? { controlCenter: options.controlCenter } : {}),
    about: readAbout,
    ...(options.agents ? { agents: options.agents } : {}),
    lock: options.lock,
    openSetup: options.openSetup,
    show: (pane, row) => open(pane, row),
    home: homedir(),
  };
}

export function startSettingsApp(options: SettingsAppOptions): SettingsApp {
  const { compositor } = options;
  const nav = new Nav();
  const focus = new RowFocus();
  const find = new FindFocus();
  attachFlagUndo(options);
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
      if (window) await compositor?.focus({ window: window.id });
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
    const ctx = paneContext(options, screens, clipboard, open);
    const stopScreens = screens.start();
    const stopWatching = options.settings.watch();
    const menus = options.menus?.();
    // The window's process, by its app id, once the compositor lists it.
    const editMenu =
      menus && compositor
        ? publishEditMenu(
            menus,
            options.settings.undo,
            async () => (await compositor.windows()).find((window) => window.appId === SETTINGS_APP_ID)?.pid ?? null,
            undefined,
            () => find.request(),
          )
        : null;
    const current: Session = {
      surface: null,
      stop: () => {
        stopScreens();
        stopWatching();
        editMenu?.stop();
      },
    };
    session = current;
    // No `surface`: an ordinary window with the compositor's window controls: over the content (the
    // unified title bar, see view.tsx) where the compositor can draw them so, else in a title bar.
    current.surface = openOverlay(
      // Its least size holds on the warm host's window too, when its `open` takes one (shared/metal/host.ts `hostTakesLeast`).
      { title: SETTINGS_TITLE, appId: SETTINGS_APP_ID, ...SETTINGS_WINDOW, titleBar: "unified" },
      <SettingsWindow ctx={ctx} nav={nav} spots={spots} find={find} />,
      () => {
        // The window went (its close button, or its host died): forget the session.
        if (session === current) session = null;
        current.stop();
      },
      // A field with the keyboard answers ❖A ❖C ❖X ❖V ❖Z itself, before the Edit menu's rows (KB-6).
      (host) => onWindowTyping(host, (typing) => editMenu?.setTyping(typing)),
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
