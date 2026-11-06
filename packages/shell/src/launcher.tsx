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
import { iconPath } from "./apps.ts";
import { useClockPrefs, usesHour24 } from "./clock.ts";
import type { Entry } from "./entries.ts";
import { fieldAccess, listAccess, pictureAccess, rowAccess } from "./launcher/access.ts";
import { agentHandlers } from "./launcher/agents/handlers.ts";
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
import type { LauncherHost, LauncherPrefsStore, LauncherRanking, LauncherWorldStore, Presented } from "./launcher/host.ts";
import { launcherIndex } from "./launcher/items.ts";
import type { LauncherCommand } from "./launcher/keys.ts";
import { linkTitle } from "./launcher/link-args.ts";
import { PANEL, SURFACE, useMeasures } from "./launcher/measures.ts";
import { chordWhen, collision } from "./launcher/person-keys.ts";
import { type ArrowsWanted, type PictureRect, STRIP_HEIGHT, trimForPictures } from "./launcher/pictures.ts";
import type { LauncherPrefsSnapshot } from "./launcher/prefs.ts";
import { nameIndent, ReservedRows, ResultRow, SectionHead } from "./launcher/row-view.tsx";
import { buildSections, FILE_ROWS, type FileRow, fileNameMatches, filesStateFor, placeholderFor, type Row, type Section, selectable } from "./launcher/rows.ts";
import type { LauncherScope, ScopeResult } from "./launcher/scope.ts";
import { keepInView, type Move, moveSelection, resolveSelection } from "./launcher/selection.ts";
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

export type { FileRow } from "./launcher/rows.ts";

/** The surface, and the measures of the panel on it at text size 1 (docs/design.html LA-1, TY-1, RA-1: the launcher's row; launcher/measures.ts). */
export const LAUNCHER = { ...SURFACE, top: 120, field: 48, fieldText: 17, radius: PANEL.radius, padding: PANEL.padding } as const;

/**
 * Files are asked as soon as the rows are drawn: one question at a time over one
 * LocalSearch connection, a newer one replacing one still waiting (file-search.ts),
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
  /** The person's languages, for Dashi's own words (ranking/locale.ts). */
  languages?: readonly string[];
  /** Keys typed between the ❖ tap and the field taking the keyboard, played in order (launcher/type-ahead.ts). */
  typeAhead?: TypeAheadSource;
  /** What comes in from outside Dashi: search providers, applets' and scripts' answers (launcher/extensions.ts). */
  extensions?: ExtensionSession;
  /** The list's height follows its rows over this many ms (a host that can: launcher/resident.tsx); unset jumps (Reduce Motion). */
  heightTransitionMs?: number;
  /** Agents: Ask, the plan, Now, history (launcher/agents/); without it the launcher knows none. */
  agents?: LauncherAgents;
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

/** Where the launcher is: searching, a row's action list, giving an alias or a key, or a link's action. */
type Mode =
  | { kind: "search" }
  | { kind: "actions"; row: Row }
  | { kind: "alias"; address: string; title: string }
  | { kind: "shortcut"; address: string; title: string; when: string | null }
  | { kind: "presented"; presented: Presented }
  /** An Ask's plan: the field takes a follow-up (launcher/agents/task-mode.tsx). */
  | { kind: "task"; id: string };

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
  const [mode, setMode] = useState<Mode>(() => (props.presented ? { kind: "presented", presented: props.presented } : { kind: "search" }));
  // The action list's own field and selection, and the destructive verb asking to be pressed again.
  const [filter, setFilter] = useState("");
  const [heldVerb, setHeldVerb] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [digits, setDigits] = useState(false);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const offset = useRef(0);
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
    limits: { local: m.localRows, files: m.fileRows },
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
  const sections = scope
    ? scope.sections(query)
    : inOutside
      ? outside
      : withAgents(outside, {
          query,
          allApps,
          snapshot: agents,
          tabbed: tabbed !== null && tabbed === text,
          ...(props.agents ? { history: props.agents.history } : {}),
          now: Math.floor(Date.now() / 1000),
        });
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

  /** Show a task's plan; the field takes a follow-up. */
  const openTask = (id: string) => {
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
      case "tab":
        // In a scope (the clipboard, snippets, a command from outside) ⇥ asks no one: the rows are the scope's own.
        return scope || inOutside ? undefined : agentKeys.tab();
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
    // A scope's list (its `window`, as many as fit at the text size) and All apps are drawn a window at a time.
    const shown = section.window !== undefined ? Math.min(section.window, m.listRows) : section.id === "all" ? m.allAppsRows : null;
    if (shown === null) return section.rows;
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
  // An Ask's plan: the spark in place of the magnifier, the request as the chip, the field for a follow-up.
  const taskField = mode.kind === "task" ? agentField(task, filter, colors.agent) : null;

  const chip =
    mode.kind === "actions"
      ? { title: mode.row.title, icon: mode.row.icon }
      : mode.kind === "presented"
        ? { title: linkTitle(mode.presented.action, mode.presented.args) }
        : mode.kind === "alias"
          ? { title: `Alias for ${mode.title}` }
          : mode.kind === "shortcut"
            ? { title: `Shortcut for ${mode.title}` }
            : (taskField?.chip ?? scope?.chip ?? ext.chip);
  const placeholder =
    mode.kind === "search"
      ? (scope?.placeholder ?? ext.placeholder ?? (agents?.answerer ? ASK_PLACEHOLDER : placeholderFor(files !== undefined && !filesOff)))
      : taskField
        ? taskField.placeholder
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
          : text
            ? pictures.count > 0
              ? [{ keys: "→", label: "windows" }, ...hintFor(selectedRow, ctx).slice(0, 2)]
              : [...hintFor(selectedRow, ctx), ...(inOutside ? [] : askHint(text, agents))]
            : []
      : taskField
        ? taskField.hints
        : mode.kind === "presented"
          ? [
              { keys: "Esc", label: "close" },
              { keys: KEYS.primary, label: "run" },
            ]
          : [{ keys: "Esc", label: "back" }];

  return (
    <View style={{ flex: 1, flexDirection: "column", alignItems: "center" }}>
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
          {...(taskField ? { glyph: taskField.glyph } : {})}
          {...(chip ? { chip } : {})}
          hints={hints}
          notice={notice}
          {...(access ? { access: { ...fieldAccess(placeholder, list !== null) } } : {})}
          onChangeText={onChangeText}
          onSubmit={() => submit()}
          onKey={onKey}
        />
        {list}
      </View>
    </View>
  );
}
