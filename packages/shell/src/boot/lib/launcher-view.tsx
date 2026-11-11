/**
 * The launcher's view for one opening (boot/launcher.tsx): its surface, and its
 * props from what the session has at that moment (the registry, the clipboard,
 * agents, the run to talk to).
 */

import { openFile } from "../../file-manager.ts";
import { LAUNCHER, Launcher, type LauncherFiles, type LauncherPrefs, type PictureRect, type Presented, type RankingMemory } from "../../launcher/index.ts";
import type { OpenOverlay } from "../../overlay.tsx";
import type { RecentApps } from "../../recents.ts";
import { recentEntries } from "../../recents.ts";
import type { Entry } from "../../shared/app-entries/index.ts";
import type { Handoff } from "../agents.ts";
import type { LauncherKeyboard } from "../keys.ts";
import type { LateParts } from "../parts.ts";
import type { Late } from "../services.ts";
import { onScreen } from "../session.ts";

/** The launcher's surface: centered at the top, over everything, with the keyboard. */
export function surfaceOptions(output: string | undefined): Parameters<OpenOverlay>[0] {
  return {
    title: "Launcher",
    width: LAUNCHER.width,
    height: LAUNCHER.height,
    surface: {
      layer: "overlay",
      anchor: ["top"],
      margin: { top: LAUNCHER.top },
      keyboard: "exclusive",
      namespace: "dashi.launcher",
      ...onScreen(output),
    },
  };
}

export interface LauncherView {
  late: Late<LateParts>;
  handoff: Handoff;
  rankingMemory: RankingMemory;
  recents: RecentApps;
  files: LauncherFiles;
  keyboard: LauncherKeyboard;
  prefs: LauncherPrefs;
  languages: string[];
  launchFromLauncher: (entry: Entry) => boolean;
  openWith: (appId: string, env: Record<string, string>) => boolean;
  pictures: (rects: PictureRect[]) => void;
  heightMs: () => number | undefined;
  access: { accessible: boolean };
}

export interface Opening {
  presented: Presented | null;
  scope: string | null;
  entries: readonly Entry[];
  talkTo: string | null;
  close: () => void;
}

/** The launcher's view for one opening, with what the session has now (the registry, the clipboard, agents). */
export function launcherElement(view: LauncherView, { presented, scope, entries, talkTo, close }: Opening) {
  const { late, handoff, keyboard, launchFromLauncher, openWith } = view;
  const world = late.peek("launcherWorld");
  const host = late.peek("launcherHost");
  const clipboard = late.peek("clipboard");
  const ask = late.peek("askAgents");
  const heightMs = view.heightMs();
  return (
    <Launcher
      entries={entries}
      recent={recentEntries(entries, view.recents.list())}
      onOpen={(entry, stay) => {
        if (!launchFromLauncher(entry)) return false;
        if (!stay) close();
        return true;
      }}
      files={view.files}
      onOpenFile={(file, stay) => {
        openFile(file.url);
        if (!stay) close();
      }}
      onSearchFiles={(query) => {
        if (openWith("dev.dashi.files", { DASHI_FILES_SEARCH: query })) close();
      }}
      onFindSoftware={(query) => {
        if (openWith("dev.dashi.software", { DASHI_SOFTWARE_SEARCH: query })) close();
      }}
      copy={(text) => late.get("launcherClipboard").writeText(text)}
      keys={keyboard.keys}
      {...(world ? { world } : {})}
      prefs={view.prefs}
      ranking={view.rankingMemory}
      {...(host ? { host } : {})}
      presented={presented}
      {...(clipboard ? { scopes: clipboard.scopes } : {})}
      scope={scope}
      languages={view.languages}
      typeAhead={keyboard.typeAhead}
      {...(ask ? { agents: ask.launcher } : {})}
      handoff={handoff.handoffShell.launcher}
      context={handoff.launcherContext}
      talkTo={talkTo}
      extensions={late.get("extensions").session}
      {...(heightMs ? { heightTransitionMs: heightMs } : {})}
      onPictures={view.pictures}
      accessible={view.access.accessible}
      onClose={close}
    />
  );
}
