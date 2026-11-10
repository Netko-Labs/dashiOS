/**
 * What the launcher holds between renders, and what its search found
 * (launcher/lib/use-search.ts), as the launcher's other parts read them. Types
 * only: nothing here loads at start.
 */

import type { Dispatch, SetStateAction } from "react";
import type { Outcome } from "../../actions/index.ts";
import type { TaskContext } from "../../agents/index.ts";
import type { Entry } from "../../entries.ts";
import type { LauncherAgentsSnapshot } from "../agent-rows.ts";
import type { HandoffSnapshot } from "../handoff-rows.ts";
import type { LauncherPrefsSnapshot } from "../prefs.ts";
import type { FileRow, Row } from "../row-model.ts";
import type { Section } from "../sections.ts";
import type { LauncherScope } from "../types.ts";
import type { Verb, VerbContext } from "../verbs.ts";
import type { WorldSnapshot } from "../world.ts";
import type { ChipsOn } from "./agents/handoff-views.tsx";
import type { Extensions } from "./extensions.ts";
import type { Mode } from "./mode.ts";
import type { PicturesState } from "./use-pictures.ts";

type Setter<T> = Dispatch<SetStateAction<T>>;

/** A notice at the field's right end ("Copied"), green or not. */
export interface Notice {
  text: string;
  ok: boolean;
}

/** Everything the launcher holds between renders. */
export interface LauncherState {
  world: WorldSnapshot;
  prefs: LauncherPrefsSnapshot;
  agents: LauncherAgentsSnapshot | null;
  handoff: HandoffSnapshot | null;
  context: TaskContext;
  /** The words ⇥ was pressed for: Ask (or "Set up an agent…") is offered for them. */
  tabbed: string | null;
  setTabbed: Setter<string | null>;
  query: string;
  setQuery: Setter<string>;
  held: string | null;
  setHeld: Setter<string | null>;
  allApps: boolean;
  setAllApps: Setter<boolean>;
  found: { query: string; files: FileRow[] | null } | null;
  setFound: Setter<{ query: string; files: FileRow[] | null } | null>;
  filesOff: boolean;
  setFilesOff: Setter<boolean>;
  lastFileCount: number;
  setLastFileCount: Setter<number>;
  copied: { query: string; ok: boolean } | null;
  setCopied: Setter<{ query: string; ok: boolean } | null>;
  failed: Entry | null;
  setFailed: Setter<Entry | null>;
  chipsOn: ChipsOn;
  setChipsOn: Setter<ChipsOn>;
  chipsShown: boolean;
  setChipsShown: Setter<boolean>;
  grantsRow: 0 | 1;
  setGrantsRow: Setter<0 | 1>;
  mode: Mode;
  setMode: Setter<Mode>;
  /** The action list's own field and selection, and the destructive verb asking to be pressed again. */
  filter: string;
  setFilter: Setter<string>;
  heldVerb: string | null;
  setHeldVerb: Setter<string | null>;
  asking: string | null;
  setAsking: Setter<string | null>;
  digits: boolean;
  setDigits: Setter<boolean>;
  notice: Notice | null;
  setNotice: Setter<Notice | null>;
  offset: { current: number };
  /** The part of a wheel line not yet turned into a row (launcher/lib/selection.ts `wheelSteps`). */
  wheelRest: { current: number };
  /** A scope narrows the panel to its rows; `alone` when it was opened for it (⌥❖V), so Esc closes. */
  scoped: { scope: LauncherScope; alone: boolean } | null;
  setScoped: Setter<{ scope: LauncherScope; alone: boolean } | null>;
  scope: LauncherScope | null;
  verbOffset: { current: number };
}

/** What the search has found, and what acting on it starts from. */
export interface Search {
  text: string;
  ctx: VerbContext;
  ext: Extensions;
  inOutside: boolean;
  contextShown: boolean;
  sections: Section[];
  rows: Row[];
  selected: string | null;
  selectedRow: Row | undefined;
  task: LauncherAgentsSnapshot["tasks"][number] | undefined;
  pictures: PicturesState;
  /** A row's verbs: its scope's, or what verbs.ts gives it. */
  verbsOf: (row: Row) => Verb[];
  /** New words in the field: the search starts again from them. */
  restart: (next: string) => void;
  /** An outcome: shown when it asked to be, else the launcher closes on success or says what failed. */
  ran: (outcome: Outcome, stay: boolean) => void;
  say: (outcome: Outcome) => void;
  sayDone: (text: string, ok?: boolean) => void;
  finish: (stay: boolean) => void;
}
