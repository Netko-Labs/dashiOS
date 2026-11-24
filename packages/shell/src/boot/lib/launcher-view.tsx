/**
 * The launcher's view for one opening (boot/launcher.tsx): its surface, and its
 * props from what the session has at that moment (the registry, the clipboard,
 * agents, the run to talk to).
 */

import { CAPSULE } from "@dashi/ui";
import { placedOutputs } from "../../arrange/index.ts";
import type { Compositor } from "../../compositor/index.ts";
import { openFile } from "../../file-manager.ts";
import {
  LAUNCHER,
  Launcher,
  type LauncherFiles,
  type LauncherPlace,
  type LauncherPrefs,
  launcherPlace,
  type PictureRect,
  type Presented,
  type RankingMemory,
} from "../../launcher/index.ts";
import type { OpenOverlay } from "../../overlay.tsx";
import type { RecentApps } from "../../recents.ts";
import { recentEntries } from "../../recents.ts";
import type { Entry } from "../../shared/app-entries/index.ts";
import type { Handoff } from "../agents.ts";
import type { LauncherKeyboard } from "../keys.ts";
import type { LateParts } from "../parts.ts";
import type { Late } from "../services.ts";
import { onScreen } from "../session.ts";
import { launcherDashi } from "./launcher-dashi.ts";

/** The launcher's surface: centered at the top, over everything, with the keyboard; shorter and higher on a short screen. */
export function surfaceOptions(output: string | undefined, place: LauncherPlace = { top: LAUNCHER.top, height: LAUNCHER.height }): Parameters<OpenOverlay>[0] {
  return {
    title: "Launcher",
    width: LAUNCHER.width,
    height: place.height,
    surface: {
      layer: "overlay",
      anchor: ["top"],
      margin: { top: place.top },
      keyboard: "exclusive",
      namespace: "dashi.launcher",
      ...onScreen(output),
    },
  };
}

/**
 * Where the person is, and how much room each screen has under its menu bar, asked together when the
 * launcher opens: on a short screen it opens higher and shorter (launcher/place.ts).
 */
export function launcherRooms(compositor: Compositor | null, whereIsPerson: () => Promise<string | undefined>) {
  const below = new Map<string, number>();
  let first: string | undefined;
  return {
    whereIsPerson: async (): Promise<string | undefined> => {
      const [name, outputs] = await Promise.all([whereIsPerson(), compositor?.outputs().catch(() => []) ?? Promise.resolve([])]);
      const placed = placedOutputs(outputs);
      first = placed[0]?.name;
      for (const each of placed) below.set(each.name, each.frame.y + each.frame.height - each.usable.y);
      return name;
    },
    placeOn: (output: string | undefined): LauncherPlace => {
      const name = output ?? first;
      return launcherPlace(name === undefined ? undefined : below.get(name));
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
  /** It opens on the conversation with Dashi's agent. */
  conversation: boolean;
  /** Its surface's height, when the screen is short (launcher/place.ts). */
  height?: number;
  close: () => void;
}

/** The launcher's view for one opening, with what the session has now (the registry, the clipboard, agents). */
export function launcherElement(view: LauncherView, { presented, scope, entries, conversation, close, height }: Opening) {
  const { late, keyboard, launchFromLauncher, openWith } = view;
  const world = late.peek("launcherWorld");
  const host = late.peek("launcherHost");
  const clipboard = late.peek("clipboard");
  const store = late.peek("storeScope");
  const scopes = [...(clipboard?.scopes ?? []), ...(store ? [store] : [])];
  const ask = late.peek("askAgents");
  const assistant = late.peek("assistant");
  const persona = late.peek("pill")?.persona.getSnapshot();
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
      {...(scopes.length > 0 ? { scopes } : {})}
      scope={scope}
      languages={view.languages}
      typeAhead={keyboard.typeAhead}
      {...(ask ? { agents: ask.launcher } : {})}
      {...(assistant ? { dashi: launcherDashi(assistant, late) } : {})}
      conversation={conversation}
      {...(persona && persona.colour.toLowerCase() !== CAPSULE.defaultPurple ? { colour: persona.colour } : {})}
      extensions={late.get("extensions").session}
      {...(heightMs ? { heightTransitionMs: heightMs } : {})}
      {...(height !== undefined ? { height } : {})}
      onPictures={view.pictures}
      accessible={view.access.accessible}
      onClose={close}
    />
  );
}
