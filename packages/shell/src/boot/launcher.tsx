/**
 * The launcher (launcher.tsx), as the shell opens it (main.tsx). Nothing on a ❖ tap touches the disk:
 * the apps are an index built once and kept fresh by inotify (launcher/app-index.ts), the history is
 * held in memory (recents.ts), icons were resolved when the index was built, and file search knows
 * whether it can look (shared/files/file-search.ts).
 */

import { homedir } from "node:os";
import { type AgentStore, type Agents, NO_CONTEXT } from "../agents/index.ts";
import { appFor } from "../apps.ts";
import { placedOutputs } from "../arrange.ts";
import type { Compositor } from "../compositor.ts";
import { type Entry, launchEntry } from "../entries.ts";
import { primarySelection, readContext } from "../handoff-shell.tsx";
import { hostIsAccessible } from "../launcher/access.ts";
import { AppIndex } from "../launcher/app-index.ts";
import { BUDGET } from "../launcher/budget.ts";
import { LaunchFailures } from "../launcher/failures.ts";
import type { Presented } from "../launcher/host.ts";
import { LauncherKeys } from "../launcher/keys.ts";
import { launcherOrigin, type PictureRect, picturesOnScreen } from "../launcher/pictures.ts";
import { LauncherPrefs } from "../launcher/prefs.ts";
import { languagesOf, messageLocales } from "../launcher/ranking/index.ts";
import { LAUNCHER_MOTION, ResidentHost } from "../launcher/resident.tsx";
import { FILE_ROWS } from "../launcher/rows.ts";
import { logTiming, markOpen, sinceOpen } from "../launcher/timing.ts";
import { LAUNCHER, type LauncherFiles } from "../launcher.tsx";
import { findFiles, hasLocalSearch, LocalSearchEndpoint } from "../local-search.ts";
import type { Notifications } from "../notifications/service.ts";
import { type OpenOverlay, openOverlay } from "../overlay.tsx";
import type { OverlaySlots } from "../overlay-slots.ts";
import { RecentApps } from "../recents.ts";
import type { SettingsStore } from "../settings-app/index.ts";
import { type App, fileIcon, METAL_HOST } from "../shared/apps/index.ts";
import { systemClipboard } from "../shared/clipboard/clipboard.ts";
import { FileSearch, iconNamesFor } from "../shared/files/file-search.ts";
import type { Handoff } from "./agents.ts";
import type { Catalog } from "./apps.ts";
import { LauncherKeyboard, TYPE_AHEAD_LIMIT_MS } from "./keys.ts";
import { type LauncherView, launcherElement, type Opening, surfaceOptions } from "./launcher-view.tsx";
import type { Look } from "./look.ts";
import type { OverlayKind } from "./overlays.tsx";
import type { LateParts } from "./parts.ts";
import type { Late, Services } from "./services.ts";
import type { Screens } from "./session.ts";

/** How other pieces open the launcher. */
export interface LauncherOpener {
  /** The launcher, unless it is up already (Search… in the Dashi menu, Try it in the Setup Assistant). */
  show(): void;
  /** The launcher in one of its scopes (⌥❖V: the clipboard history), over `window`; one already open gives way. */
  openIn(scope: string, window: number | null): void;
  /** Opens the launcher, presenting an action or in a scope over a window. */
  open(presented?: Presented | null, scope?: string | null, window?: number | null): void;
  /** ❖ tapped: closes an open launcher, else opens one. */
  toggle(): void;
}

export interface LauncherParts {
  opener: LauncherOpener;
  appIndex: AppIndex;
  keyboard: LauncherKeyboard;
  prefs: LauncherPrefs;
  /** The person's languages, for Dashi's own words in the launcher (shared/locale/messages.ts). */
  languages: string[];
}

interface LauncherNeeds {
  compositor: Compositor | null;
  apps: App[];
  screens: Screens;
  overlays: OverlaySlots<OverlayKind>;
  settingsStore: SettingsStore;
  notifications: Notifications;
  look: Look;
  catalog: Catalog;
  agentStore: AgentStore;
  agents: Agents | null;
  handoff: Handoff;
  screenLocked: () => boolean;
  services: Services;
  late: Late<LateParts>;
}

/** Files over one LocalSearch D-Bus connection, ranked by name then recency (local-search.ts). */
function startFileSearch(services: Services): LauncherFiles {
  const localSearch = new LocalSearchEndpoint();
  services.add("file search", () => localSearch.close());
  const fileSearch = new FileSearch({ ask: (query, limit) => findFiles(localSearch.ask, query, homedir(), limit), installed: hasLocalSearch() });
  return {
    isAvailable: () => fileSearch.isAvailable(),
    // More than the slots hold, best first: the rows keep the names that read as names (row-model.ts `fileNameMatches`).
    find: async (query) => (await fileSearch.find(query, FILE_ROWS * 4))?.map((hit) => ({ ...hit, icon: fileIcon(iconNamesFor(hit)) })) ?? null,
  };
}

/**
 * The open launcher's window pictures (launcher/pictures.ts), from its surface's pixels to the
 * screen's: layer-shell puts it centered across the usable area, LAUNCHER.top down. The first
 * pictures wait for the list to finish growing to make room for them. In order, one at a time.
 */
function windowPictures(compositor: Compositor | null, output: () => string | undefined, heightMs: () => number | undefined) {
  let shown = false;
  let queue: Promise<void> = Promise.resolve();
  return (rects: PictureRect[]): void => {
    if (!compositor) return;
    const wait = rects.length > 0 && !shown ? (heightMs() ?? 0) : 0;
    shown = rects.length > 0;
    queue = queue
      .then(async () => {
        if (wait > 0) await Bun.sleep(wait);
        if (rects.length === 0) return void (await compositor.windowThumbnails({ rects: [] }));
        const outputs = placedOutputs(await compositor.outputs());
        const screen = outputs.find((each) => each.name === output()) ?? outputs[0];
        if (!screen) return;
        await compositor.windowThumbnails({ rects: picturesOnScreen(rects, launcherOrigin(screen.usable, LAUNCHER.width, LAUNCHER.top)) });
      })
      .catch((error) => console.error("dashi-shell: the launcher's window pictures:", error));
  };
}

/**
 * The launcher's own host, kept for the session and shown and hidden (launcher/resident.tsx); with a
 * host binary that can't, it opens on the warm host as other overlays do.
 */
function residentSurface(keyboard: LauncherKeyboard): { resident: ResidentHost; open: OpenOverlay } {
  const resident = new ResidentHost(METAL_HOST, {
    onFrame: (ms) => {
      logTiming("open → first frame", sinceOpen() ?? ms, BUDGET.openMs, "resident host");
      keyboard.ready();
    },
  });
  const open: OpenOverlay = (options, element, onClosed) => {
    const shown = resident.open(options, element, onClosed);
    if (shown) return shown;
    const opened = sinceOpen();
    if (opened !== null) logTiming("open → surface asked", opened, BUDGET.openMs, "no resident host: first frame not reported");
    // An older host reports no first frame: its answer to a layout question says it is up.
    return openOverlay(options, element, onClosed, (host) => {
      host.onEvent((event) => {
        const kind: string = event.type;
        if (kind === "layout" || kind === "frame") keyboard.ready();
      });
      host.simulate({ kind: "layout" });
    });
  };
  return { resident, open };
}

/** The launcher: its index, history, files, keyboard and surface; and how the rest of the shell opens it. */
export function startLauncher(needs: LauncherNeeds): LauncherParts {
  const { compositor, overlays, settingsStore, notifications, services, late } = needs;
  const appIndex = new AppIndex();
  const stopAppIndex = appIndex.start();
  const recents = new RecentApps();
  // Read now, at startup, so the first tap doesn't.
  recents.list();
  const files = startFileSearch(services);
  const launcherKeys = new LauncherKeys();
  // Copying an answer: wl-copy, a child of the shell, so the compositor serves it data-control.
  late.set("launcherClipboard", systemClipboard());
  const launchFailures = new LaunchFailures(notifications.store);
  services.add("launcher", () => {
    stopAppIndex();
    launchFailures.close();
  });
  const keyboard = new LauncherKeyboard(compositor, launcherKeys, overlays);
  /** The screen the open launcher is on, for its windows' pictures. */
  const where: { output: string | undefined } = { output: undefined };
  const pictures = windowPictures(
    compositor,
    () => where.output,
    () => heightMs(),
  );
  // The Metal host publishes an accessibility tree (launcher/access.ts): the launcher's rows then say what they are.
  const access = late.set("launcherAccess", { accessible: false });
  void hostIsAccessible(METAL_HOST).then((accessible) => {
    access.accessible = accessible;
  });
  const prefs = new LauncherPrefs(settingsStore);
  keyboard.followPersonKeys(prefs, settingsStore, services);
  const languages = languagesOf(messageLocales(process.env));
  keyboard.followTypeAhead();

  /** Start `entry` from the launcher; false when it could not be started at all. One that quits at once is a notification. */
  const launchFromLauncher = (entry: Entry): boolean => {
    const pid = launchEntry(entry, {
      failed: () => {
        recents.forget(entry.id);
        launchFailures.quit(entry.name, () => launchFromLauncher(entry));
      },
    });
    if (pid === null) return false;
    recents.remember(entry.id);
    return true;
  };
  /** Open a first-party app with a word for it to look for (`env`); false when it isn't installed. */
  const openWith = late.set("openWith", (appId: string, env: Record<string, string>): boolean => {
    const entry = appIndex.entries().find((each) => each.id === appId);
    return entry ? launchEntry({ ...entry, env: { ...entry.env, ...env } }) !== null : false;
  });
  const surface = residentSurface(keyboard);
  /** The list's height follows its rows on Dashi's curve (120 ms), on a host that can and without Reduce Motion. */
  const heightMs = (): number | undefined => (surface.resident.isReady() && !needs.look.state.reduceMotion ? LAUNCHER_MOTION.heightMs : undefined);
  const view: LauncherView = {
    late,
    handoff: needs.handoff,
    rankingMemory: needs.catalog.rankingMemory,
    recents,
    files,
    keyboard,
    prefs,
    languages,
    launchFromLauncher,
    openWith,
    pictures,
    heightMs,
    access,
  };
  const opener = launcherOpener(needs, keyboard, appIndex, (opening) => (onClosed, output) => {
    where.output = output;
    return surface.open(surfaceOptions(output), launcherElement(view, opening), onClosed);
  });
  return { opener, appIndex, keyboard, prefs, languages };
}

type Surface = (onClosed: () => void, output: string | undefined) => ReturnType<OpenOverlay>;

/** How the launcher opens and closes: never over the lock screen, its keys with it, its context read first. */
function launcherOpener(needs: LauncherNeeds, keyboard: LauncherKeyboard, appIndex: AppIndex, surfaceFor: (opening: Opening) => Surface): LauncherOpener {
  const { compositor, overlays, handoff, late } = needs;
  const open = (presented: Presented | null = null, scope: string | null = null, window: number | null = null): void => {
    // Never behind the lock screen (a dashi:// link, Search…): it would hold keys nobody sees.
    if (needs.screenLocked()) return;
    markOpen();
    // Where the clipboard's ↩ pastes: the window under the launcher.
    late.peek("clipboard")?.opening(window);
    keyboard.opening();
    const limit = setTimeout(keyboard.ready, TYPE_AHEAD_LIMIT_MS);
    const close = () => overlays.close("launcher");
    const entries = appIndex.entries();
    // The run this launcher opens talking to (a notification's Follow up), once.
    const talkTo = handoff.talk.run;
    handoff.talk.run = null;
    // The context chips: the window in front and the selection, read before the launcher takes the keyboard.
    handoff.launcherContext.set(NO_CONTEXT);
    handoff.handoffShell.service.refresh();
    if (compositor && !presented && !scope) readFrontContext(needs, compositor);
    void late.peek("launcherWorld")?.refresh();
    let opened = false;
    const finished = () => {
      clearTimeout(limit);
      keyboard.closed();
    };
    const surface = surfaceFor({ presented, scope, entries, talkTo, close });
    const showing = overlays.showOn("launcher", needs.screens.whereIsPerson, (onClosed, output) => {
      opened = true;
      // Its keys come with the surface and go with it, however it closes.
      return surface(() => {
        finished();
        onClosed();
      }, output);
    });
    // Closed before it had a screen (a second tap): its keys go back as they were.
    void showing.then(() => {
      if (!opened) finished();
    });
  };
  return {
    show: () => {
      if (!overlays.has("launcher")) open();
    },
    openIn: (scope, window) => {
      if (overlays.has("launcher")) overlays.close("launcher");
      open(null, scope, window);
    },
    open,
    toggle: () => (overlays.has("launcher") ? overlays.close("launcher") : open()),
  };
}

/** The window in front, the page in Helium and the selection, for the launcher's context chips. */
function readFrontContext({ apps, catalog, agents, handoff }: LauncherNeeds, compositor: Compositor): void {
  void readContext({
    window: async () => {
      const front = (await compositor.windows()).find((each) => each.focused && each.state === "normal");
      return front ? { id: front.id, app: appFor(apps, front, catalog.installedApp).name, appId: front.appId, title: front.title } : null;
    },
    page: () => agents?.frontPage() ?? Promise.resolve(null),
    selection: primarySelection,
  }).then((context) => handoff.launcherContext.set(context));
}
