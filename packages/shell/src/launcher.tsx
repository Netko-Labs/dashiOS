/**
 * The launcher (❖Space or a tap of ❖): a search field over installed apps,
 * Settings panes and settings, open windows, Dashi's commands, the menus of
 * running apps, files (through LocalSearch), and sums. What it lists is
 * launcher/rows.ts, ranked by launcher/ranking/ over launcher/items.ts; what
 * a row can do is launcher/verbs.ts; how the selection moves is
 * launcher/selection.ts.
 *
 * - The selection is a row's id: files that land late never put another row
 *   under it, and Enter acts on the row highlighted when it is pressed.
 * - ↑ ↓ (and ⌃P ⌃N) wrap; Page Up and Page Down, Home and End (launcher/keys.ts);
 *   the pointer over a row selects it. Esc steps out: the action list or a
 *   chip, then the typed words, then the launcher.
 * - ↩ does the row's thing, ⇧↩ and stays open; ❖↩ and ⌥↩ the second and
 *   third (New window, Bring here, Show in Files), ❖C copies, ❖1–9 picks a
 *   row (the digits show while ❖ is held).
 * - ❖K or a right-click turns the rows into the selected row's actions, in
 *   place: the chip names it, typing filters, Esc goes back.
 * - Space on a setting with a switch flips it; Enter opens Settings there.
 * - A sum is the first row: Enter copies it, and it says so in place.
 * - Nothing found offers Did you mean, Search files, and Find in Software.
 * - With nothing typed: Recent, else a few things to try, then All apps.
 * - → on a row with windows shows them live under it; ← → pick, ↩ switches (launcher/pictures.ts).
 * - Type and rows grow with the text size (launcher/measures.ts); a screen reader hears the field,
 *   the rows and the selection (launcher/access.ts).
 * - A scope (launcher/scope.ts: the clipboard history at ⌥❖V, snippets)
 *   narrows the panel to its rows behind a chip; Esc leaves it.
 */

import { useColors } from "@dashi/ui";
import { View } from "@mirinjs/metal";
import { type ReactNode, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Outcome } from "./actions/types.ts";
import type { HarnessId } from "./agents/ask/answerer.ts";
import { contextPrompt, NO_CONTEXT, type TaskContext } from "./agents/handoff/grants.ts";
import { harnessGlyph } from "./agents/handoff/harness-icons.ts";
import { cut } from "./agents/handoff/words.ts";
import type { Entry } from "./entries.ts";
import { fieldAccess, listAccess, pictureAccess, rowAccess } from "./launcher/access.ts";
import type { AgentAct } from "./launcher/agents/acts.ts";
import { agentHandlers } from "./launcher/agents/handlers.ts";
import { type HandoffSnapshot, handoffHints, harnessByDigit, type LauncherHandoff, runRow, showsContext, withHandoff } from "./launcher/agents/handoff-rows.ts";
import { type ChipsOn, ContextChips, chipsHeight, chosenContext, GrantsCard } from "./launcher/agents/handoff-views.tsx";
import {
  ASK_PLACEHOLDER,
  askHint,
  firstChoice,
  type LauncherAgents,
  type LauncherAgentsSnapshot,
  SET_UP_ROW,
  withAgents,
  withStop,
} from "./launcher/agents/rows.ts";
import { agentField, PlanList, stepAct } from "./launcher/agents/task-mode.tsx";
import { BUDGET } from "./launcher/budget.ts";
import { aliasRows, aliasToKeep, mayKeep, shortcutRows } from "./launcher/editing.ts";
import { type ExtensionSession, useExtensions } from "./launcher/extensions.ts";
import { Field } from "./launcher/field.tsx";
import { fitToRoom } from "./launcher/fit.ts";
import type { LauncherHost, LauncherPrefsStore, LauncherRanking, LauncherWorldStore, Presented, Store } from "./launcher/host.ts";
import { launcherIndex } from "./launcher/items.ts";
import { type ExtraKeys, type LauncherCommand, NO_EXTRA_KEYS } from "./launcher/keys.ts";
import { linkTitle } from "./launcher/link-args.ts";
import { PANEL, SURFACE, useMeasures } from "./launcher/measures.ts";
import { chordWhen, collision } from "./launcher/person-keys.ts";
import { type ArrowsWanted, type PictureRect, STRIP_HEIGHT, trimForPictures } from "./launcher/pictures.ts";
import type { LauncherPrefsSnapshot } from "./launcher/prefs.ts";
import { nameIndent, ReservedRows, ResultRow, SectionHead } from "./launcher/row-view.tsx";
import { buildSections, FILE_ROWS, type FileRow, fileNameMatches, filesStateFor, placeholderFor, type Row, type Section, selectable } from "./launcher/rows.ts";
import type { LauncherScope, ScopeResult } from "./launcher/scope.ts";
import { keepInView, type Move, moveSelection, resolveSelection, wheelSteps } from "./launcher/selection.ts";
import { logTiming, timingNow } from "./launcher/timing.ts";
import { applyEdits } from "./launcher/type-ahead.ts";
import { usePictures } from "./launcher/use-pictures.ts";
import { type TypeAheadSource, useTypeAhead } from "./launcher/use-type-ahead.ts";
import {
  type Effect,
  filterVerbs,
  hintFor,
  historyId,
  KEYS,
  presentedVerbs,
  spaceFlips,
  type Verb,
  type VerbContext,
  verbRow,
  verbsFor,
} from "./launcher/verbs.ts";
import { WindowStrip } from "./launcher/window-strip.tsx";
import type { WorldSnapshot } from "./launcher/world.ts";
import { iconPath } from "./shared/apps/index.ts";
import { useClockPrefs, usesHour24 } from "./shared/time/clock.ts";

export type { FileRow } from "./launcher/rows.ts";

/** The surface, and the measures of the panel on it at text size 1 (docs/design.html LA-1, TY-1, RA-1: the launcher's row; launcher/measures.ts). */
export const LAUNCHER = { ...SURFACE, top: 120, field: 48, fieldText: 17, radius: PANEL.radius, padding: PANEL.padding } as const;

/**
 * Files are asked as soon as the rows are drawn: one question at a time over one
 * LocalSearch connection, a newer one replacing one still waiting (shared/files/file-search.ts),
 * so typing never queues them up, and they have 80 ms to fill their slots (launcher/budget.ts).
 */
export const FILE_DELAY_MS = 0;
/** How long a notice ("Copied") stays at the field's right end. */
const NOTICE_MS = 2_000;

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

export interface LauncherProps {
  entries: readonly Entry[];
  /** Shown while the field is empty. */
  recent?: readonly Entry[];
  /** Start an entry. False when it could not be: the launcher stays open and says so. `stay`: ⇧↩, it stays open. */
  onOpen: (entry: Entry, stay?: boolean) => boolean;
  /** Files named like the query; without it the launcher looks through apps and settings only. */
  files?: LauncherFiles;
  onOpenFile?: (file: FileRow, stay?: boolean) => void;
  /** Look for `query` in Files (the folder walk works with LocalSearch off too). */
  onSearchFiles?: (query: string) => void;
  onFindSoftware?: (query: string) => void;
  /** Put text on the clipboard; whether it worked. */
  copy?: (text: string) => Promise<boolean>;
  keys?: LauncherKeySource;
  /** The registry's actions and the open windows (launcher/world.ts). */
  world?: LauncherWorldStore;
  /** The person's aliases and keys (launcher/prefs.ts). */
  prefs?: LauncherPrefsStore;
  /** The ranking's history (launcher/ranking/store.ts). */
  ranking?: LauncherRanking;
  /** What the rows' other verbs reach. */
  host?: LauncherHost;
  /** A link's action, waiting for Return. */
  presented?: Presented | null;
  /** The person's languages, for Dashi's own words (shared/locale/messages.ts). */
  languages?: readonly string[];
  /** Keys typed between the ❖ tap and the field taking the keyboard, played in order (launcher/type-ahead.ts). */
  typeAhead?: TypeAheadSource;
  /** What comes in from outside Dashi: search providers, applets' and scripts' answers (launcher/extensions.ts). */
  extensions?: ExtensionSession;
  /** The list's height follows its rows over this many ms (a host that can: launcher/resident.tsx); unset jumps (Reduce Motion). */
  heightTransitionMs?: number;
  /** Agents: Ask, the plan, Now, history (launcher/agents/); without it the launcher knows none. */
  agents?: LauncherAgents;
  /** Agents from the launcher: "Hand it off", the grants card, the runs (launcher/agents/handoff-rows.ts). */
  handoff?: LauncherHandoff;
  /** The window in front when the launcher opened, and what was selected: the context chips (filled in as it opens). */
  context?: Store<TaskContext>;
  /** Open talking to this run (a done notification's Follow up). */
  talkTo?: string | null;
  /** Narrowed views of the panel (launcher/scope.ts): choosing one's address enters it. */
  scopes?: readonly LauncherScope[];
  /** Open in this scope (its id), for it alone: Esc closes. */
  scope?: string | null;
  /** Where the compositor draws windows' live pictures, in the surface's pixels; empty clears them (launcher/pictures.ts). */
  onPictures?: (rects: PictureRect[]) => void;
  /** The host publishes an accessibility tree (launcher/access.ts): the rows say what they are. */
  accessible?: boolean;
  onClose: () => void;
}

/** The scope the launcher opens in, if it was opened for one. */
const scopeNamed = (scopes: readonly LauncherScope[] | undefined, id: string | null | undefined) =>
  id ? (scopes?.find((each) => each.id === id) ?? null) : null;

const ICONS = { calculator: iconPath("calculator"), files: iconPath("files"), software: iconPath("software"), command: iconPath("settings") };

const NO_WORLD: WorldSnapshot = { actions: [], windows: [], serial: 0 };
const NO_PREFS: LauncherPrefsSnapshot = { aliases: new Map(), aliasOf: () => undefined, keyOf: () => undefined };
const noStore = { subscribe: () => () => {}, getSnapshot: () => NO_WORLD };
const noPrefs = { subscribe: () => () => {}, getSnapshot: () => NO_PREFS };
const noAgents = { subscribe: () => () => {}, getSnapshot: (): LauncherAgentsSnapshot | null => null };
const noHandoff = { subscribe: () => () => {}, getSnapshot: (): HandoffSnapshot | null => null };
const noContext = { subscribe: () => () => {}, getSnapshot: (): TaskContext => NO_CONTEXT };

/** Where the launcher is: searching, a row's action list, giving an alias or a key, or a link's action. */
type Mode =
  | { kind: "search" }
  | { kind: "actions"; row: Row }
  | { kind: "alias"; address: string; title: string }
  | { kind: "shortcut"; address: string; title: string; when: string | null }
  | { kind: "presented"; presented: Presented }
  /** An Ask's plan: the field takes a follow-up (launcher/agents/task-mode.tsx). */
  | { kind: "task"; id: string }
  /** The grants card before a task starts: Return starts it (launcher/agents/handoff-views.tsx). */
  | { kind: "grants"; harness: HarnessId; watch: boolean }
  /** Words to a run (⇥ on its row, Follow up): Return sends them. */
  | { kind: "message"; run: string };

export function Launcher(props: LauncherProps) {
  const { entries, recent = [], files, keys, onClose, host, ranking } = props;
  const colors = useColors();
  // Type and rows at the person's text size, and how many rows fit (launcher/measures.ts).
  const m = useMeasures();
  const world = useSyncExternalStore(props.world?.subscribe ?? noStore.subscribe, props.world?.getSnapshot ?? noStore.getSnapshot);
  const prefs = useSyncExternalStore(props.prefs?.subscribe ?? noPrefs.subscribe, props.prefs?.getSnapshot ?? noPrefs.getSnapshot);
  const agents = useSyncExternalStore(props.agents?.subscribe ?? noAgents.subscribe, props.agents?.getSnapshot ?? noAgents.getSnapshot);
  // The words ⇥ was pressed for: Ask (or "Set up an agent…") is offered for them.
  const [tabbed, setTabbed] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [held, setHeld] = useState<string | null>(null);
  const [allApps, setAllApps] = useState(false);
  const [found, setFound] = useState<{ query: string; files: FileRow[] | null } | null>(null);
  const [filesOff, setFilesOff] = useState(() => files !== undefined && !files.isAvailable());
  // How many file rows the last answer had: that many slots are held while the next one comes
  // (all of them before the first answer, so the panel never grows when files arrive).
  const [lastFileCount, setLastFileCount] = useState(FILE_ROWS);
  const [copied, setCopied] = useState<{ query: string; ok: boolean } | null>(null);
  const [failed, setFailed] = useState<Entry | null>(null);
  const handoff = useSyncExternalStore(props.handoff?.subscribe ?? noHandoff.subscribe, props.handoff?.getSnapshot ?? noHandoff.getSnapshot);
  const context = useSyncExternalStore(props.context?.subscribe ?? noContext.subscribe, props.context?.getSnapshot ?? noContext.getSnapshot);
  // The context chips: the window in front is on until dropped; the selection only when chosen. Once shown they stay.
  const [chipsOn, setChipsOn] = useState<ChipsOn>({ window: true, selection: false });
  const [chipsShown, setChipsShown] = useState(false);
  const [grantsRow, setGrantsRow] = useState<0 | 1>(0);
  const [mode, setMode] = useState<Mode>(() =>
    props.presented ? { kind: "presented", presented: props.presented } : props.talkTo ? { kind: "message", run: props.talkTo } : { kind: "search" },
  );
  // The action list's own field and selection, and the destructive verb asking to be pressed again.
  const [filter, setFilter] = useState("");
  const [heldVerb, setHeldVerb] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [digits, setDigits] = useState(false);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const offset = useRef(0);
  /** The part of a wheel line not yet turned into a row (launcher/selection.ts `wheelSteps`). */
  const wheelRest = useRef(0);
  // A scope narrows the panel to its rows; `alone` when it was opened for it (⌥❖V), so Esc closes.
  const [scoped, setScoped] = useState<{ scope: LauncherScope; alone: boolean } | null>(() => {
    const opened = scopeNamed(props.scopes, props.scope);
    return opened ? { scope: opened, alone: true } : null;
  });
  const scope = scoped?.scope ?? null;
  useSyncExternalStore(scope?.subscribe ?? noStore.subscribe, scope?.getSnapshot ?? noStore.getSnapshot);
  const verbOffset = useRef(0);

  const text = query.trim();
  const filesState = filesStateFor({ query, offered: files !== undefined && !scope, off: filesOff, answer: found, lastCount: lastFileCount });
  const waiting = filesState.kind === "waiting";

  useEffect(() => {
    if (!files || !waiting) return;
    let current = true;
    const timer = setTimeout(() => {
      const asked = timingNow();
      void files.find(text).then((hits) => {
        // An answer for what was typed before is dropped.
        if (!current) return;
        if (asked !== null) logTiming("files", performance.now() - asked, BUDGET.filesMs);
        setFound({ query: text, files: hits });
        if (hits === null) setFilesOff(true);
        else setLastFileCount(Math.min(hits.filter((hit) => fileNameMatches(hit.name, text)).length, FILE_ROWS));
      });
    }, FILE_DELAY_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [files, waiting, text]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  // A link that arrives while the launcher is open takes its place.
  useEffect(() => {
    if (props.presented) setMode({ kind: "presented", presented: props.presented });
  }, [props.presented]);

  const index = useMemo(
    () => launcherIndex({ entries, actions: world.actions, windows: world.windows, ...(props.languages ? { languages: props.languages } : {}) }),
    [entries, world.actions, world.windows, props.languages],
  );
  const ctx: VerbContext = {
    windows: world.windows,
    actions: world.actions,
    aliasOf: prefs.aliasOf,
    keyOf: prefs.keyOf,
    ...(host ? { pinned: (entry: Entry) => host.pinned(entry) } : {}),
  };

  // Answers in the Region's numbers and the person's clock (answers/).
  const clock = useClockPrefs();
  const answers = { locale: clock.locale, hour24: usesHour24(clock) };
  const working = timingNow();
  // From outside Dashi: providers' rows below the rest, and what a command asks to show (launcher/extensions.ts).
  // A launcher scope (the clipboard, snippets) asks no provider: its rows are its own. An applet's view is
  // placed at the text size's field and rows (one object while the size is, so it isn't placed again each render).
  const viewMeasures = useMemo(() => ({ width: LAUNCHER.width, padding: LAUNCHER.padding, field: m.field, row: m.row }), [m.field, m.row]);
  const ext = useExtensions(
    {
      session: props.extensions,
      query,
      searching: mode.kind === "search" && !scope,
      restart: (next) => restart(next),
      select: (id) => setHeld(id),
      run: (action, args) => void host?.run(action, args).then((outcome) => ran(outcome, false)),
    },
    viewMeasures,
  );
  const searched = buildSections({
    answers,
    // In a scope its own rows show: the search's are the empty field's, which cost nothing.
    query: scope ? "" : query,
    entries,
    recent: recent.slice(0, m.listRows - 1),
    limits: { local: m.localRows, files: m.fileRows, allApps: m.allAppsRows },
    files: filesState,
    index,
    windows: world.windows,
    aliases: prefs.aliases,
    ...(ranking ? { signals: ranking } : {}),
    allApps,
    copied,
    failed,
    icons: ICONS,
  });
  // From outside Dashi: a command's answer on top and providers' rows below the rest; in a command's own
  // scope (a pick, a view, its words) only its rows (launcher/extensions.ts).
  const outside = ext.sections(searched);
  // A scope has its own rows only, and so does a command from outside. Otherwise agents' rows go around the
  // rest, never between them: Now on top of an empty field, Ask last (launcher/agents/rows.ts).
  const inOutside = ext.chip !== undefined;
  const isTabbed = tabbed !== null && tabbed === text;
  const assembled = scope
    ? scope.sections(query)
    : inOutside
      ? outside
      : withHandoff(
          withAgents(outside, {
            query,
            allApps,
            snapshot: agents,
            tabbed: isTabbed,
            ...(props.agents ? { history: props.agents.history } : {}),
            now: Math.floor(Date.now() / 1000),
          }),
          { query, allApps, snapshot: handoff, tabbed: isTabbed },
        );
  // The context chips show once the words read as a request, and stay for this opening (⌫ in an empty field drops one).
  const contextShown =
    mode.kind === "search" &&
    !scope &&
    !inOutside &&
    (context.window !== null || context.selection !== null) &&
    (chipsShown || showsContext(text, handoff, Boolean(agents?.answerer)));
  useEffect(() => {
    if (contextShown && !chipsShown) setChipsShown(true);
  }, [contextShown, chipsShown]);
  // Whatever added rows (providers, agents), the list fits the panel at the text size (launcher/fit.ts), under the chips.
  const sections = fitToRoom(assembled, { height: m.room - (contextShown ? chipsHeight(m.textSize) : 0), row: m.row, head: m.head });
  /** A row's verbs: its scope's, or what verbs.ts gives it. */
  const verbsOf = (row: Row): Verb[] => (scope ? scope.verbs(row, text) : verbsFor(row, ctx));
  if (working !== null) logTiming("rows worked out", performance.now() - working, BUDGET.instantMs);
  // Keystroke → its rows committed (and so sent to the host), with DASHI_LAUNCHER_TIMING=1 (launcher/timing.ts).
  const typedAt = useRef<number | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: it runs once each typed query is committed, which is the moment it times
  useEffect(() => {
    if (typedAt.current === null) return;
    logTiming("keystroke → rows sent", performance.now() - typedAt.current, BUDGET.keystrokeMs);
    typedAt.current = null;
  }, [query]);
  const rows = selectable(sections);
  const rowIds = rows.map((row) => row.id);
  // With nothing held the first row, but never Ask: it is chosen, not given.
  const selected = held !== null && rowIds.includes(held) ? held : firstChoice(rowIds);
  const selectedRow = rows.find((row) => row.id === selected);
  const task = mode.kind === "task" ? agents?.tasks.find((each) => each.id === mode.id) : undefined;
  // The selected row's windows, live under it after → (launcher/pictures.ts); not in a scope, whose rows are its own.
  const arrows = useMemo(() => (keys?.arrows ? (want: ArrowsWanted) => keys.arrows?.(want) : undefined), [keys]);
  const pictures = usePictures({
    selectedRow,
    windows: world.windows,
    searching: mode.kind === "search" && !scope && !inOutside,
    ...(arrows ? { arrows } : {}),
    ...(props.onPictures ? { onPictures: props.onPictures } : {}),
  });

  // The action list, or what the alias and shortcut fields offer.
  const verbs: Verb[] =
    mode.kind === "actions"
      ? filterVerbs(verbsOf(mode.row), filter)
      : mode.kind === "presented"
        ? filterVerbs(presentedVerbs(mode.presented.action, mode.presented.args, ctx), filter)
        : [];
  const shortcutFound = mode.kind === "shortcut" && mode.when !== null && host ? collision(mode.when, host.keymap(), (bind) => host.describe(bind)) : null;
  const editRows: Row[] =
    mode.kind === "alias"
      ? aliasRows(filter, mode.title, mode.address, prefs.aliases, (address) => host?.describe(address) ?? address)
      : mode.kind === "shortcut"
        ? shortcutRows(mode.when, mode.title, shortcutFound)
        : [];
  const verbRows = verbs.map((each) => verbRow(each, asking === each.id));
  const verbIds = verbRows.map((row) => row.id);
  const selectedVerbId = resolveSelection(verbIds, heldVerb);
  // As many of the action list's rows as fit at the text size, the selected one in view.
  verbOffset.current = keepInView(Math.max(0, verbIds.indexOf(selectedVerbId ?? "")), verbOffset.current, m.listRows, verbRows.length);
  const shownVerbs = verbRows.slice(verbOffset.current, verbOffset.current + m.listRows);
  const stepIds = task ? task.steps.map((_, at) => `step:${at}`) : [];
  const listIds = mode.kind === "search" ? rowIds : mode.kind === "task" ? stepIds : verbIds;
  // A plan's steps start with none selected: ↓ selects the first, ↑ the last.
  const heldStep = mode.kind === "task" && heldVerb?.startsWith("step:") && stepIds.includes(heldVerb) ? Number(heldVerb.slice(5)) : null;

  const latest = useRef(listIds);
  latest.current = listIds;
  const mover = (how: Move) => {
    pictures.fold();
    if (mode.kind === "grants") {
      setGrantsRow((now) => (how === "up" || how === "first" || how === "page-up" ? 0 : how === "down" || how === "last" || how === "page-down" ? 1 : now));
      return;
    }
    if (mode.kind === "search") setHeld((now) => moveSelection(latest.current, now, how));
    else if (mode.kind === "task")
      setHeldVerb((now) =>
        now === null ? (latest.current[how === "up" || how === "last" ? latest.current.length - 1 : 0] ?? null) : moveSelection(latest.current, now, how),
      );
    else setHeldVerb((now) => moveSelection(latest.current, now, how));
    setAsking(null);
  };
  const move = useRef(mover);
  move.current = mover;
  // The compositor's keys (⌃N, Page Down, Home…) move it as ↑ and ↓ do; `latest` is read when they come.
  useEffect(() => keys?.subscribe((how) => move.current(how)), [keys]);

  const say = (outcome: Outcome) => setNotice(outcome.ok ? { text: outcome.text, ok: true } : { text: outcome.error, ok: false });
  const sayDone = (text: string, ok = true) => setNotice({ text, ok });
  const finish = (stay: boolean) => {
    if (!stay) onClose();
  };

  const backToSearch = () => {
    if (mode.kind === "shortcut") keys?.record?.(false);
    setMode({ kind: "search" });
    setFilter("");
    setHeldVerb(null);
    setAsking(null);
  };

  // Bumped to give the field its text back after a key the launcher took (launcher/field.tsx).
  const [fieldRevision, setFieldRevision] = useState(0);
  const restart = (next: string) => {
    typedAt.current = timingNow();
    pictures.fold();
    setQuery(next);
    setHeld(null);
    setAllApps(false);
    setFailed(null);
    setNotice(null);
  };

  const openActions = (row: Row | undefined) => {
    if (!row || verbsOf(row).length < 2) return;
    setMode({ kind: "actions", row });
    setFilter("");
    setHeldVerb(null);
    setAsking(null);
  };

  /** What the ranking learns: this row was chosen for what was typed (or opened, with nothing typed). */
  const learn = (row: Row | undefined) => {
    const id = row ? historyId(row) : null;
    if (!ranking || !id || row?.id.startsWith("try:")) return;
    if (row?.action.kind === "open-file") ranking.opened(id);
    else if (text) ranking.picked(text, id);
    else ranking.opened(id);
  };

  const ran = (outcome: Outcome, stay: boolean) => {
    if (ext.shown(outcome)) return;
    if (outcome.ok) finish(stay);
    else say(outcome);
  };

  /**
   * Show a task's plan; the field takes a follow-up. The words asked are the plan's now (its chip; ⇥ edits
   * them): the search is left empty, so going back to it never puts them in the field again, where they
   * took the place of what was typed next ("history" right after a plan ran).
   */
  const openTask = (id: string) => {
    restart("");
    setMode({ kind: "task", id });
    setFilter("");
    setHeldVerb(null);
    setAsking(null);
  };
  // Agents' rows, ⇥, and Return on a plan (launcher/agents/handlers.ts).
  const agentKeys = agentHandlers({
    agents: props.agents,
    snapshot: agents,
    mode: mode.kind === "search" || mode.kind === "task" ? mode.kind : "other",
    task,
    text,
    draft: filter,
    selectedRow,
    openTask,
    clearDraft: () => setFilter(""),
    editWords: (words) => {
      backToSearch();
      restart(words);
    },
    back: backToSearch,
    close: onClose,
    say,
    sayDone,
    offerSetUp: (words) => {
      setTabbed(words);
      setHeld(SET_UP_ROW);
    },
    // Ask gets the context chips too: the ones left on, in words, after the request.
    context: () => (contextShown ? contextPrompt(chosenContext(context, chipsOn), false) : ""),
  });
  /** Into a scope, in place (its row chosen), or out of it (Esc): the field starts empty. */
  const enterScope = (next: LauncherScope | null) => {
    setScoped(next ? { scope: next, alone: false } : null);
    backToSearch();
    restart("");
  };
  /** What a scope's verb asked for once it ran. */
  const scopeDone = (result: ScopeResult, stay: boolean) => {
    if (result.close && !stay) return onClose();
    if (mode.kind !== "search") backToSearch();
    if (result.query !== undefined) restart(result.query);
    if (result.notice) setNotice(result.notice);
  };

  /** The words and the chips left on: what a hand-off starts with. */
  const handOff = (harness: HarnessId, request: string, watch: boolean) => {
    const remote = props.handoff;
    if (!remote || !request.trim()) return;
    const chosen = chosenContext(context, chipsOn);
    if (remote.needsCard(chosen)) {
      setMode({ kind: "grants", harness, watch });
      setFilter(request.trim());
      setGrantsRow(0);
      return;
    }
    remote.start({ harness, request: request.trim(), context: chosen }, watch);
    onClose();
  };
  const talkTo = (run: string) => {
    setMode({ kind: "message", run });
    setFilter("");
    setHeldVerb(null);
  };
  /** Agents from the launcher's own acts; false for the rest (launcher/agents/handlers.ts has them). */
  const handoffAct = (act: AgentAct): boolean => {
    const remote = props.handoff;
    if (!remote) return false;
    switch (act.kind) {
      case "hand-off":
        handOff(act.harness, act.query, act.watch === true);
        return true;
      case "sign-in-harness":
        remote.signIn(act.harness);
        onClose();
        return true;
      case "run":
        remote.open(act.run);
        onClose();
        return true;
      case "stop-run":
        remote.stop(act.run);
        sayDone("Stopped");
        return true;
      case "tell":
        talkTo(act.run);
        return true;
      default:
        return false;
    }
  };

  const perform = (effect: Effect, row: Row | undefined, stay = false): void => {
    const runOf = (promise: Promise<Outcome> | undefined) => void promise?.then((outcome) => ran(outcome, stay));
    switch (effect.kind) {
      case "open":
        learn(row);
        if (!props.onOpen(effect.entry, stay)) {
          setFailed(effect.entry);
          setHeld(`failed:${effect.entry.id}`);
        }
        return;
      case "focus":
        learn(row);
        void host?.focus(effect.window).then(() => finish(stay));
        return;
      case "run": {
        learn(row);
        const entering = props.scopes?.find((each) => each.address === effect.item.action?.address);
        if (entering) return enterScope(entering);
        if (ext.intercept(effect.item)) return;
        if (effect.item.action) runOf(host?.run(effect.item.action));
        return;
      }
      case "scope":
        if (scope) void Promise.resolve(scope.run(effect.verb, row, text)).then((result) => scopeDone(result, stay));
        return;
      case "run-args":
        runOf(host?.run(effect.action, effect.args));
        return;
      case "reveal":
        learn(row);
        if (effect.item.action?.place) host?.reveal(effect.item.action.place);
        finish(stay);
        return;
      case "toggle":
        if (effect.item.action) void host?.run(effect.item.action).then((outcome) => !outcome.ok && say(outcome));
        return;
      case "open-file":
        learn(row);
        return props.onOpenFile?.(effect.file, stay);
      case "copy": {
        const isAnswer = row?.id === "answer";
        if (!props.copy) return isAnswer ? setCopied({ query: text, ok: false }) : sayDone("Couldn't copy", false);
        void props.copy(effect.text).then((ok) => (isAnswer ? setCopied({ query: text, ok }) : sayDone(ok ? "Copied" : "Couldn't copy", ok)));
        if (mode.kind !== "search") backToSearch();
        return;
      }
      case "type":
        return restart(effect.query);
      case "search-files":
        return props.onSearchFiles?.(effect.query);
      case "find-software":
        return props.onFindSoftware?.(effect.query);
      case "all-apps":
        offset.current = 0;
        setAllApps(true);
        setHeld(null);
        return;
      case "agent":
        if (handoffAct(effect.act)) return;
        return agentKeys.act(effect.act);
      case "new-window":
        learn(row);
        if (host?.newWindow(effect.entry)) finish(stay);
        else sayDone(`Couldn't open a new ${effect.entry.name} window`, false);
        return;
      case "bring-here":
        void host?.bringHere(effect.window).then(() => finish(stay));
        return;
      case "minimize":
        void host?.minimize(effect.window);
        return backToSearch();
      case "close":
        void host?.close(effect.window);
        return backToSearch();
      case "quit":
        void host?.quit(effect.windows);
        // Quit is done once asked, like the other verbs: the launcher goes (⇧↩ stays and says so).
        if (!stay) return finish(false);
        sayDone(`Quitting ${effect.name}`);
        return backToSearch();
      case "show-in-files":
        host?.showInFiles(effect.file);
        return finish(stay);
      case "trash":
        void host?.trash(effect.file).then((ok) => sayDone(ok ? `Moved “${effect.file.name}” to the Trash` : "Couldn't move it to the Trash", ok));
        return backToSearch();
      case "pin":
        host?.pin(effect.entry, effect.pin);
        sayDone(effect.pin ? "Kept in Dock" : "Removed from Dock");
        return backToSearch();
      case "alias":
        setMode({ kind: "alias", address: effect.address, title: effect.title });
        setFilter(prefs.aliasOf(effect.address) ?? "");
        return;
      case "unalias":
        props.prefs?.setAlias(effect.address, null);
        sayDone("Alias removed");
        return backToSearch();
      case "shortcut":
        setMode({ kind: "shortcut", address: effect.address, title: effect.title, when: null });
        setFilter("");
        keys?.record?.(true);
        return;
      case "unshortcut":
        props.prefs?.setKey(effect.address, null);
        sayDone("Shortcut removed");
        return backToSearch();
      case "forget":
        ranking?.forget(effect.id);
        sayDone("Ranking reset");
        return backToSearch();
      case "forget-all":
        ranking?.forgetAll();
        sayDone("All ranking reset");
        return backToSearch();
    }
  };

  /** Do `verb`, asking first in place when it says to. */
  const doVerb = (verb: Verb | undefined, row: Row | undefined, stay = false) => {
    if (!verb) return;
    if (verb.confirm && asking !== verb.id) {
      setAsking(verb.id);
      setHeldVerb(`verb:${verb.id}`);
      if (mode.kind === "search" && row) setMode({ kind: "actions", row });
      return;
    }
    setAsking(null);
    perform(verb.effect, row, stay);
  };

  /** The row the keys act on: the action list's row, or the selected one. */
  const target = (): Row | undefined => (mode.kind === "actions" ? mode.row : mode.kind === "search" ? selectedRow : undefined);
  const byKey = (key: string) => {
    const row = target();
    if (row)
      doVerb(
        verbsOf(row).find((each) => each.key === key),
        row,
      );
  };

  const submit = (stay = false) => {
    switch (mode.kind) {
      case "search":
        // A picked window's picture: switch to that window.
        if (pictures.picked) return perform({ kind: "focus", window: pictures.picked }, selectedRow, stay);
        if (ext.submit()) return;
        return doVerb(selectedRow ? verbsOf(selectedRow)[0] : undefined, selectedRow, stay);
      case "actions":
      case "presented":
        return doVerb(
          verbs.find((each) => `verb:${each.id}` === selectedVerbId),
          mode.kind === "actions" ? mode.row : undefined,
          stay,
        );
      case "alias": {
        const alias = aliasToKeep(filter);
        if (!alias) return;
        props.prefs?.setAlias(mode.address, alias);
        sayDone(`“${alias}” is ${mode.title} now`);
        return backToSearch();
      }
      case "shortcut":
        if (!mode.when || !mayKeep(mode.when, shortcutFound)) return;
        props.prefs?.setKey(mode.address, mode.when);
        sayDone("Shortcut kept");
        return backToSearch();
      case "task":
        return agentKeys.submit(heldStep);
      case "grants": {
        if (grantsRow === 1) {
          props.handoff?.settings();
          return onClose();
        }
        const request = filter.trim();
        if (!request || !props.handoff) return;
        props.handoff.start({ harness: mode.harness, request, context: chosenContext(context, chipsOn) }, mode.watch);
        return onClose();
      }
      case "message": {
        const words = filter.trim();
        if (!words) return;
        const run = handoff?.runs.find((each) => each.id === mode.run);
        if (props.handoff?.tell(mode.run, words)) {
          setFilter("");
          sayDone(`Sent to ${run?.harnessName ?? "the agent"}`);
          setTimeout(onClose, 600);
        } else sayDone("That agent is gone", false);
        return;
      }
    }
  };

  const command = (cmd: LauncherCommand) => {
    switch (cmd.kind) {
      case "actions":
        return mode.kind === "actions" ? backToSearch() : mode.kind === "search" ? openActions(selectedRow) : undefined;
      case "secondary":
        return byKey(KEYS.secondary);
      case "third":
        return byKey(KEYS.third);
      case "copy":
        return byKey(KEYS.copy);
      case "quit":
        return byKey(KEYS.quit);
      case "alias":
        return byKey(KEYS.alias);
      case "shortcut":
        return byKey(KEYS.shortcut);
      case "keep-open":
        return submit(true);
      case "pick": {
        const row = mode.kind === "search" ? drawnRows()[cmd.digit - 1] : undefined;
        if (row) doVerb(verbsOf(row)[0], row);
        return;
      }
      case "digits":
        return setDigits(cmd.shown);
      case "record":
        if (mode.kind === "shortcut") setMode({ ...mode, when: chordWhen(cmd.chord) });
        return;
      case "tab": {
        // In a scope (the clipboard, snippets, a command from outside) ⇥ asks no one: the rows are the scope's own.
        if (scope || inOutside || mode.kind === "grants" || mode.kind === "message") return;
        // On a run's row, ⇥ turns the field into words to it.
        const act = selectedRow?.action.kind === "agent" ? selectedRow.action.act : null;
        if (mode.kind === "search" && !text && act?.kind === "run") return talkTo(act.run);
        return agentKeys.tab();
      }
      case "option-pick": {
        const harness = mode.kind === "search" ? harnessByDigit(handoff, cmd.digit) : null;
        if (harness) handOff(harness, text, false);
        return;
      }
      case "stop": {
        const act = selectedRow?.action.kind === "agent" ? selectedRow.action.act : null;
        if (mode.kind === "search" && act?.kind === "run") handoffAct({ kind: "stop-run", run: act.run });
        return;
      }
      case "backspace":
        if (chipsOn.selection) setChipsOn({ ...chipsOn, selection: false });
        else if (chipsOn.window) setChipsOn({ ...chipsOn, window: false });
        return;
      case "settings":
        if (mode.kind === "grants") {
          props.handoff?.settings();
          onClose();
        }
        return;
      case "arrow":
        pictures.arrow(cmd.to);
        return;
    }
  };
  const commands = useRef(command);
  commands.current = command;
  useEffect(() => keys?.subscribeCommands?.((cmd) => commands.current(cmd)), [keys]);
  // Recording ends with the launcher, however it closes.
  useEffect(() => () => keys?.record?.(false), [keys]);
  // A failed ask leaves Now once the launcher closes (it was seen); its history line stays.
  useEffect(() => () => props.agents?.closed?.(), [props.agents]);

  const onChangeText = (next: string) => {
    if (mode.kind !== "search") {
      setFilter(next);
      setHeldVerb(null);
      setAsking(null);
      return;
    }
    // Space on a row with a switch flips it, unless it is the next letter of the row's name.
    if (next === `${query} ` && selectedRow && spaceFlips(selectedRow, query)) {
      const flip = verbsOf(selectedRow).find((each) => each.key === KEYS.flip);
      if (flip) {
        // The field already shows the space; take it back, so the next letter follows the words.
        setFieldRevision((revision) => revision + 1);
        return perform(flip.effect, selectedRow);
      }
    }
    restart(next);
  };

  const onKey = (key: "Escape" | "ArrowUp" | "ArrowDown") => {
    if (key === "ArrowDown") return move.current("down");
    if (key === "ArrowUp") return move.current("up");
    // Esc steps out: the action list or a chip, then All apps, then the typed words, then the launcher.
    // A link opened the launcher for its action alone: Esc closes it. Windows' pictures fold first.
    if (pictures.fold()) return;
    if (mode.kind === "presented") return onClose();
    // Esc while an answer is still coming gives up on it (launcher/agents/handlers.ts `leave`).
    if (mode.kind === "task") agentKeys.leave();
    if (mode.kind !== "search") return backToSearch();
    // A command from outside's own scope first, then a launcher scope's chip: back to the whole launcher,
    // or closed when it was opened for the scope.
    if (ext.escape()) return;
    if (scoped) return scoped.alone ? onClose() : enterScope(null);
    if (allApps && !query) return setAllApps(false);
    if (query) return restart("");
    onClose();
  };

  // What was typed before the field had the keyboard, in order (launcher/type-ahead.ts).
  useTypeAhead(props.typeAhead, {
    edit: (edits) => onChangeText(applyEdits(mode.kind === "search" ? query : filter, edits)),
    key: (key) => {
      if (key === "Return") return submit();
      onKey(key === "Up" ? "ArrowUp" : key === "Down" ? "ArrowDown" : "Escape");
    },
  });

  const drawn = (section: Section): Row[] => {
    // A scope's list and All apps (a `window`, as many as fit at the text size) are drawn a window at a time.
    if (section.window === undefined) return section.rows;
    const shown = Math.min(section.window, m.listRows);
    const at = Math.max(
      0,
      section.rows.findIndex((row) => row.id === selected),
    );
    // With a row's pictures open, fewer of them, so the pictures fit too.
    const size = pictures.rowId ? Math.min(shown, Math.max(1, Math.floor((m.room - m.head - STRIP_HEIGHT) / m.row))) : shown;
    offset.current = keepInView(at, offset.current, size, section.rows.length);
    return section.rows.slice(offset.current, offset.current + size);
  };
  // With a row's pictures open, the rows below it give way so the panel still fits (launcher/pictures.ts).
  const onScreen = trimForPictures(
    sections.map((section) => ({ ...section, rows: drawn(section) })),
    m,
    pictures.rowId,
  );
  /** The rows on screen, top to bottom: what ❖1–9 pick. */
  function drawnRows(): Row[] {
    return onScreen.flatMap((section) => section.rows);
  }
  const digitOf = new Map(
    digits && mode.kind === "search"
      ? drawnRows()
          .slice(0, 9)
          .map((row, at) => [row.id, at + 1] as const)
      : [],
  );

  // What a screen reader hears (launcher/access.ts): only on a host that publishes the tree.
  const access = props.accessible === true;
  const spoken = (row: Row, list: readonly Row[], isSelected: boolean, expanded?: boolean) =>
    access ? { access: { ...rowAccess(row, list.indexOf(row) + 1, list.length, isSelected, expanded) } } : {};
  let list: ReactNode = null;
  const listBox = (children: ReactNode) => (
    <View
      testID="launcher:list"
      {...(access ? listAccess(mode.kind === "search" ? "Results" : "Actions") : {})}
      // The wheel and the touchpad move the selection, as ↑ and ↓ do, so a list drawn a window at a time scrolls.
      onWheel={(event) => {
        const { steps, rest } = wheelSteps(wheelRest.current, event.dy);
        wheelRest.current = rest;
        for (let step = 0; step < Math.abs(steps); step++) move.current(steps > 0 ? "down" : "up");
      }}
      style={{
        flexDirection: "column",
        borderTopWidth: 1,
        borderColor: colors.separator,
        padding: LAUNCHER.padding,
        ...(props.heightTransitionMs ? { heightTransitionMs: props.heightTransitionMs } : {}),
      }}
    >
      {children}
    </View>
  );
  if (mode.kind === "search" && sections.length > 0) {
    list = listBox(
      onScreen.map((section) => (
        <View key={section.id} testID={`launcher:section:${section.id}`} style={{ flexDirection: "column" }}>
          {section.title !== undefined && <SectionHead title={section.title} {...(section.aside ? { aside: section.aside } : {})} />}
          {section.rows.flatMap((row) => {
            const showing = row.id === pictures.rowId;
            const shownRow = showing && pictures.picked ? { ...row, detail: pictures.picked.title.trim() || pictures.picked.appName } : row;
            return [
              <ResultRow
                key={row.id}
                row={shownRow}
                selected={row.id === selected}
                onPress={() => doVerb(verbsOf(row)[0], row)}
                onHover={() => setHeld(row.id)}
                onContextMenu={() => {
                  setHeld(row.id);
                  openActions(row);
                }}
                {...(digitOf.has(row.id) ? { digit: digitOf.get(row.id) as number } : {})}
                {...spoken(row, rows, row.id === selected, showing ? true : undefined)}
                {...withStop(row, agentKeys.act)}
              />,
              ...(showing
                ? [
                    <WindowStrip
                      key={`${row.id}:pictures`}
                      windows={pictures.shown}
                      picked={pictures.pickedIndex}
                      indent={nameIndent(m)}
                      onLayout={pictures.layout}
                      onPick={(index) => pictures.pick(index)}
                      {...(access
                        ? {
                            access: (window, index) => ({
                              ...pictureAccess(
                                window.title.trim() || window.appName,
                                pictures.at - pictures.pickedIndex + index + 1,
                                pictures.count,
                                index === pictures.pickedIndex,
                              ),
                            }),
                          }
                        : {})}
                    />,
                  ]
                : []),
            ];
          })}
          {section.reserved !== undefined && <ReservedRows count={section.reserved} />}
        </View>
      )),
    );
  } else if (mode.kind === "actions" || mode.kind === "presented") {
    list = listBox(
      <View testID="launcher:section:actions" style={{ flexDirection: "column" }}>
        {shownVerbs.map((row) => (
          <ResultRow
            key={row.id}
            row={row}
            selected={row.id === selectedVerbId}
            onPress={() => doVerb(verbs[verbRows.indexOf(row)], mode.kind === "actions" ? mode.row : undefined)}
            onHover={() => setHeldVerb(row.id)}
            {...spoken(row, verbRows, row.id === selectedVerbId)}
          />
        ))}
      </View>,
    );
  } else if (editRows.length > 0) {
    list = listBox(
      <View testID={`launcher:section:${mode.kind}`} style={{ flexDirection: "column" }}>
        {editRows.map((row) => (
          <ResultRow key={row.id} row={row} selected={row.shortcut !== undefined} onPress={() => submit()} onHover={() => {}} />
        ))}
      </View>,
    );
  } else if (mode.kind === "task" && task) {
    list = listBox(
      <PlanList
        task={task}
        selected={heldStep}
        onStep={(at) => {
          const step = task.steps[at];
          if (step && stepAct(step)) agentKeys.submit(at);
        }}
        onHover={(at) => setHeldVerb(`step:${at}`)}
      />,
    );
  }
  if (mode.kind === "grants") {
    const harness = handoff?.harnesses.find((each) => each.id === mode.harness);
    list = listBox(
      <GrantsCard
        harness={harness?.name ?? "The agent"}
        context={chosenContext(context, chipsOn)}
        selected={grantsRow}
        onStart={() => {
          setGrantsRow(0);
          submit();
        }}
        onChange={() => {
          props.handoff?.settings();
          onClose();
        }}
        onHover={setGrantsRow}
      />,
    );
  }
  const messaged = mode.kind === "message" ? handoff?.runs.find((each) => each.id === mode.run) : undefined;
  if (messaged) {
    const row = runRow(messaged);
    list = listBox(
      <View testID="launcher:section:message" style={{ flexDirection: "column" }}>
        <ResultRow row={row} selected={false} onPress={() => props.handoff?.open(messaged.id)} onHover={() => {}} />
      </View>,
    );
  }
  // An Ask's plan: the spark in place of the magnifier, the request as the chip, the field for a follow-up.
  const taskField = mode.kind === "task" ? agentField(task, filter, colors.agent) : null;
  // The grants card and words to a run: that harness's mark, in shiso, where the magnifier was.
  const fieldHarness = mode.kind === "grants" ? mode.harness : mode.kind === "message" ? messaged?.harness : undefined;
  const sparkGlyph = { markup: harnessGlyph(fieldHarness), color: colors.agent };
  // The agents' keys the launcher takes now (launcher/keys.ts `ExtraKeys`).
  const selectedAct = mode.kind === "search" && selectedRow?.action.kind === "agent" ? selectedRow.action.act : null;
  const extraKeys: ExtraKeys = {
    option: mode.kind === "search" && sections.some((section) => section.id === "handoff") && (handoff?.harnesses.length ?? 0) > 1,
    stop: selectedAct?.kind === "run" && selectedRow?.stop === true,
    backspace: contextShown && !query && (chipsOn.window || chipsOn.selection),
    settings: mode.kind === "grants",
  };
  const extrasKey = JSON.stringify(extraKeys);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key stands for the object, which is new each render
  useEffect(() => keys?.extras?.(extraKeys), [keys, extrasKey]);
  useEffect(() => () => keys?.extras?.(NO_EXTRA_KEYS), [keys]);

  const chip =
    mode.kind === "actions"
      ? { title: mode.row.title, icon: mode.row.icon }
      : mode.kind === "presented"
        ? { title: linkTitle(mode.presented.action, mode.presented.args) }
        : mode.kind === "alias"
          ? { title: `Alias for ${mode.title}` }
          : mode.kind === "shortcut"
            ? { title: `Shortcut for ${mode.title}` }
            : messaged
              ? { title: cut(messaged.request, 32) }
              : (taskField?.chip ?? scope?.chip ?? ext.chip);
  const placeholder: string | readonly string[] =
    mode.kind === "search"
      ? (scope?.placeholder ?? ext.placeholder ?? (agents?.answerer ? ASK_PLACEHOLDER : placeholderFor(files !== undefined && !filesOff)))
      : taskField
        ? taskField.placeholder
        : mode.kind === "message"
          ? `Tell ${messaged?.harnessName ?? "it"} something`
          : mode.kind === "grants"
            ? "What should it do?"
            : mode.kind === "alias"
              ? "An alias, like ff"
              : mode.kind === "shortcut"
                ? "Press the keys"
                : "Search actions";
  const hints =
    mode.kind === "search"
      ? scope
        ? scope.hints(selectedRow)
        : pictures.picked
          ? [
              { keys: "← →", label: "pick" },
              { keys: KEYS.primary, label: "switch" },
            ]
          : (handoffHints(selectedRow) ??
            (text
              ? pictures.count > 0
                ? [{ keys: "→", label: "windows" }, ...hintFor(selectedRow, ctx).slice(0, 2)]
                : [...hintFor(selectedRow, ctx), ...(inOutside ? [] : askHint(text, agents))]
              : []))
      : taskField
        ? taskField.hints
        : mode.kind === "grants"
          ? [
              { keys: KEYS.primary, label: `Start ${handoff?.harnesses.find((each) => each.id === mode.harness)?.name ?? ""}`.trim() },
              { keys: "Esc", label: "Back" },
            ]
          : mode.kind === "message"
            ? [
                { keys: KEYS.primary, label: "Send" },
                { keys: "Esc", label: "Back" },
              ]
            : mode.kind === "presented"
              ? [
                  { keys: "Esc", label: "close" },
                  { keys: KEYS.primary, label: "run" },
                ]
              : [{ keys: "Esc", label: "back" }];

  return (
    // The focus ring is kombu in every control inside (KB-2).
    <View testID="launcher-root" style={{ flex: 1, flexDirection: "column", alignItems: "center", focusRingColor: colors.focusRing }}>
      {/* A click anywhere outside the panel closes the launcher. */}
      <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} onPress={onClose} />
      <View
        occlude
        style={{
          width: LAUNCHER.width,
          flexDirection: "column",
          borderRadius: LAUNCHER.radius,
          backgroundColor: colors.launcher,
          borderWidth: 1,
          borderColor: colors.separator,
          shadow: "xl",
          overflow: "hidden",
        }}
      >
        <Field
          value={mode.kind === "search" ? query : filter}
          revision={fieldRevision}
          placeholder={placeholder}
          {...(taskField ? { glyph: taskField.glyph } : mode.kind === "grants" || mode.kind === "message" ? { glyph: sparkGlyph } : {})}
          {...(chip ? { chip } : {})}
          hints={hints}
          notice={notice}
          {...(access ? { access: { ...fieldAccess(typeof placeholder === "string" ? placeholder : (placeholder[0] ?? ""), list !== null) } } : {})}
          onChangeText={onChangeText}
          onSubmit={() => submit()}
          onKey={onKey}
        />
        {contextShown && <ContextChips context={context} on={chipsOn} onToggle={(which) => setChipsOn({ ...chipsOn, [which]: !chipsOn[which] })} />}
        {list}
      </View>
    </View>
  );
}
