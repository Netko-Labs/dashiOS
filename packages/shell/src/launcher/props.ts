/**
 * What the launcher (launcher.tsx) is given, in four groups: what it searches
 * (`LauncherSources`), what its rows reach (`LauncherReach`), the agents
 * (`LauncherAgentProps`), and how this opening looks and hears keys
 * (`LauncherOpening`). The component takes them as one flat set of props.
 * Types only: nothing here loads at start.
 */

import type { TaskContext } from "../agents/index.ts";
import type { Entry } from "../entries.ts";
import type { LauncherHandoff } from "./agents/handoff-rows.ts";
import type { LauncherAgents } from "./agents/rows.ts";
import type { ExtensionSession } from "./extensions.ts";
import type { LauncherHost, LauncherPrefsStore, LauncherRanking, LauncherWorldStore, Presented, Store } from "./host.ts";
import type { ExtraKeys, LauncherCommand } from "./keys.ts";
import type { ArrowsWanted, PictureRect } from "./pictures.ts";
import type { FileRow } from "./rows.ts";
import type { LauncherScope } from "./scope.ts";
import type { Move } from "./selection.ts";
import type { TypeAheadSource } from "./use-type-ahead.ts";

/** Files for the launcher: whether it can look now (the placeholder says), and the looking; null when it couldn't. */
export interface LauncherFiles {
  isAvailable(): boolean;
  find(query: string): Promise<FileRow[] | null>;
}

/** The compositor's keys for the launcher while it is open (launcher/keys.ts). */
export interface LauncherKeySource {
  subscribe(listener: (move: Move) => void): () => void;
  subscribeCommands?(listener: (command: LauncherCommand) => void): () => void;
  /** Set shortcut… listens for a chord (every ❖ chord is the launcher's meanwhile). */
  record?(on: boolean): void;
  /** What ← and → are for now: the field's, or the windows' pictures' (launcher/pictures.ts). */
  arrows?(want: ArrowsWanted): void;
  /** The agents' keys wanted now: ⌥1–9, ❖⌫, ⌫ on a chip, ❖, (launcher/keys.ts `ExtraKeys`). */
  extras?(want: ExtraKeys): void;
}

/** What the launcher searches and ranks. */
export interface LauncherSources {
  entries: readonly Entry[];
  /** Shown while the field is empty. */
  recent?: readonly Entry[];
  /** Files named like the query; without it the launcher looks through apps and settings only. */
  files?: LauncherFiles;
  /** The registry's actions and the open windows (launcher/world.ts). */
  world?: LauncherWorldStore;
  /** The person's aliases and keys (launcher/prefs.ts). */
  prefs?: LauncherPrefsStore;
  /** The ranking's history (launcher/ranking/store.ts). */
  ranking?: LauncherRanking;
  /** The person's languages, for Dashi's own words (shared/locale/messages.ts). */
  languages?: readonly string[];
  /** What comes in from outside Dashi: search providers, applets' and scripts' answers (launcher/extensions.ts). */
  extensions?: ExtensionSession;
  /** Narrowed views of the panel (launcher/scope.ts): choosing one's address enters it. */
  scopes?: readonly LauncherScope[];
}

/** What the launcher's rows reach outside it. */
export interface LauncherReach {
  /** Start an entry. False when it could not be: the launcher stays open and says so. `stay`: ⇧↩, it stays open. */
  onOpen: (entry: Entry, stay?: boolean) => boolean;
  onOpenFile?: (file: FileRow, stay?: boolean) => void;
  /** Look for `query` in Files (the folder walk works with LocalSearch off too). */
  onSearchFiles?: (query: string) => void;
  onFindSoftware?: (query: string) => void;
  /** Put text on the clipboard; whether it worked. */
  copy?: (text: string) => Promise<boolean>;
  /** What the rows' other verbs reach. */
  host?: LauncherHost;
  /** Where the compositor draws windows' live pictures, in the surface's pixels; empty clears them (launcher/pictures.ts). */
  onPictures?: (rects: PictureRect[]) => void;
  onClose: () => void;
}

/** Agents in the launcher. */
export interface LauncherAgentProps {
  /** Agents: Ask, the plan, Now, history (launcher/agents/); without it the launcher knows none. */
  agents?: LauncherAgents;
  /** Agents from the launcher: "Hand it off", the grants card, the runs (launcher/agents/handoff-rows.ts). */
  handoff?: LauncherHandoff;
  /** The window in front when the launcher opened, and what was selected: the context chips (filled in as it opens). */
  context?: Store<TaskContext>;
  /** Open talking to this run (a done notification's Follow up). */
  talkTo?: string | null;
}

/** How this opening looks and hears keys. */
export interface LauncherOpening {
  keys?: LauncherKeySource;
  /** A link's action, waiting for Return. */
  presented?: Presented | null;
  /** Keys typed between the ❖ tap and the field taking the keyboard, played in order (launcher/type-ahead.ts). */
  typeAhead?: TypeAheadSource;
  /** Open in this scope (its id), for it alone: Esc closes. */
  scope?: string | null;
  /** The list's height follows its rows over this many ms (a host that can: launcher/resident.tsx); unset jumps (Reduce Motion). */
  heightTransitionMs?: number;
  /** The host publishes an accessibility tree (launcher/access.ts): the rows say what they are. */
  accessible?: boolean;
}

export type LauncherProps = LauncherSources & LauncherReach & LauncherAgentProps & LauncherOpening;
