/**
 * The launcher's state and its search (launcher.tsx): what it holds between
 * renders, the files it asks for, and the rows the words find, from the apps,
 * the registry, providers from outside, a scope, and the agents.
 */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Outcome } from "../../actions/index.ts";
import type { TranscriptView } from "../../agents/index.ts";
import type { Entry } from "../../shared/app-entries/index.ts";
import { useClockPrefs } from "../../shared/time/index.ts";
import { BUDGET } from "../budget.ts";
import type { Presented } from "../host.ts";
import type { ArrowsWanted } from "../pictures.ts";
import type { LauncherPrefsSnapshot } from "../prefs.ts";
import type { LauncherAgentProps, LauncherOpening, LauncherProps, LauncherSources } from "../props.ts";
import { type FileRow, fileNameMatches, type Row } from "../row-model.ts";
import { FILE_ROWS, filesStateFor, type Section } from "../sections.ts";
import { logTiming, timingNow } from "../timing.ts";
import type { LauncherAgentsSnapshot, LauncherScope } from "../types.ts";
import { type Verb, verbsFor } from "../verbs.ts";
import type { WorldSnapshot } from "../world.ts";
import { firstChoice, withAgents } from "./agents/agent-rows.ts";
import { type Extensions, useExtensions } from "./extensions.ts";
import { fitToRoom } from "./fit.ts";
import { launcherIndex } from "./items.ts";
import { type Measures, PANEL, SURFACE } from "./measures.ts";
import { initialMode, type Mode } from "./mode.ts";
import { selectable } from "./rows.ts";
import { foundSections, verbContext } from "./search-rows.ts";
import type { LauncherState, Notice, Search } from "./state.ts";
import { treeScope } from "./tree-scope.ts";
import { usePictures } from "./use-pictures.ts";

/**
 * Files are asked as soon as the rows are drawn: one question at a time over one
 * LocalSearch connection, a newer one replacing one still waiting (shared/files/file-search.ts),
 * so typing never queues them up, and they have 80 ms to fill their slots (launcher/budget.ts).
 */
export const FILE_DELAY_MS = 0;
/** How long a notice ("Copied") stays at the field's right end. */
const NOTICE_MS = 2_000;

const NO_WORLD: WorldSnapshot = { actions: [], windows: [], serial: 0 };
const NO_PREFS: LauncherPrefsSnapshot = { aliases: new Map(), aliasOf: () => undefined, keyOf: () => undefined };
const noStore = { subscribe: () => () => {}, getSnapshot: () => NO_WORLD };
const noPrefs = { subscribe: () => () => {}, getSnapshot: () => NO_PREFS };
const noAgents = { subscribe: () => () => {}, getSnapshot: (): LauncherAgentsSnapshot | null => null };
const NO_TALK: TranscriptView = { conversation: null, turns: [], working: false, background: false, waiting: null };
const noTalk = { subscribe: () => () => {}, getSnapshot: (): TranscriptView => NO_TALK };

/** The scope the launcher opens in, if it was opened for one. */
const scopeNamed = (scopes: readonly LauncherScope[] | undefined, id: string | null | undefined) =>
  id ? (scopes?.find((each) => each.id === id) ?? null) : null;

/** The stores the launcher follows, and its own state. */
export function useLauncherState(props: LauncherSources & LauncherAgentProps & LauncherOpening & Pick<LauncherProps, "files">): LauncherState {
  const { files } = props;
  const world = useSyncExternalStore(props.world?.subscribe ?? noStore.subscribe, props.world?.getSnapshot ?? noStore.getSnapshot);
  const prefs = useSyncExternalStore(props.prefs?.subscribe ?? noPrefs.subscribe, props.prefs?.getSnapshot ?? noPrefs.getSnapshot);
  const agents = useSyncExternalStore(props.agents?.subscribe ?? noAgents.subscribe, props.agents?.getSnapshot ?? noAgents.getSnapshot);
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
  // The conversation with Dashi's agent, spoken and typed turns alike (lib/talk/).
  const talk = useSyncExternalStore(props.dashi?.subscribe ?? noTalk.subscribe, props.dashi?.getSnapshot ?? noTalk.getSnapshot);
  const [tryAt, setTryAt] = useState(0);
  const [mode, setMode] = useState<Mode>(() => initialMode(props.presented, props.conversation));
  const [filter, setFilter] = useState("");
  const [heldVerb, setHeldVerb] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [digits, setDigits] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const offset = useRef(0);
  const wheelRest = useRef(0);
  const [scoped, setScoped] = useState<{ scope: LauncherScope; alone: boolean } | null>(() => {
    const opened = scopeNamed(props.scopes, props.scope);
    return opened ? { scope: opened, alone: true } : null;
  });
  const scope = scoped?.scope ?? null;
  useSyncExternalStore(scope?.subscribe ?? noStore.subscribe, scope?.getSnapshot ?? noStore.getSnapshot);
  const verbOffset = useRef(0);
  return {
    ...{ world, prefs, agents, talk, tryAt, setTryAt, tabbed, setTabbed, query, setQuery, held, setHeld, allApps, setAllApps, found, setFound },
    ...{ filesOff, setFilesOff, lastFileCount, setLastFileCount, copied, setCopied, failed, setFailed },
    ...{ mode, setMode, filter, setFilter, heldVerb, setHeldVerb },
    ...{ asking, setAsking, digits, setDigits, notice, setNotice, offset, wheelRest, scoped, setScoped, scope, verbOffset },
  };
}

/** Files are asked for what is typed, once the rows are drawn; an answer for older words is dropped. */
function useFiles(props: Pick<LauncherProps, "files">, s: LauncherState, text: string, waiting: boolean): void {
  const { files } = props;
  const { setFound, setFilesOff, setLastFileCount } = s;
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
  }, [files, waiting, text, setFound, setFilesOff, setLastFileCount]);
}

/** A notice goes after a moment; a link that arrives while the launcher is open takes its place. */
function useNoticeAndLink(presented: Presented | null | undefined, s: LauncherState): void {
  const { notice, setNotice, setMode } = s;
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice, setNotice]);

  // A link that arrives while the launcher is open takes its place.
  useEffect(() => {
    if (presented) setMode({ kind: "presented", presented });
  }, [presented, setMode]);
}

/** The rows for what is typed: found, assembled with what came from outside and the agents', fitted to the panel. */
export function useSearch(props: LauncherProps, s: LauncherState, m: Measures): Search {
  const { files, host, keys, onClose } = props;
  const { query, mode, scope, world, held } = s;
  const text = query.trim();
  const filesState = filesStateFor({ query, offered: files !== undefined && !scope, off: s.filesOff, answer: s.found, lastCount: s.lastFileCount });
  useFiles(props, s, text, filesState.kind === "waiting");
  useNoticeAndLink(props.presented, s);
  const index = useMemo(
    () => launcherIndex({ entries: props.entries, actions: world.actions, windows: world.windows, ...(props.languages ? { languages: props.languages } : {}) }),
    [props.entries, world.actions, world.windows, props.languages],
  );
  const ctx = verbContext(s, host);
  // Answers in the Region's numbers and the person's clock (answers/).
  const clock = useClockPrefs();
  const working = timingNow();
  // From outside Dashi: providers' rows below the rest, and what a command asks to show (launcher/lib/extensions.ts).
  // A launcher scope (the clipboard, snippets) asks no provider: its rows are its own. An applet's view is
  // placed at the text size's field and rows (one object while the size is, so it isn't placed again each render).
  const viewMeasures = useMemo(() => ({ width: SURFACE.width, padding: PANEL.padding, field: m.field, row: m.row }), [m.field, m.row]);
  const ext = useExtensions(
    {
      session: props.extensions,
      query,
      searching: mode.kind === "search" && !scope,
      restart: (next) => restart(next),
      select: (id) => s.setHeld(id),
      run: (action, args) => void host?.run(action, args).then((outcome) => ran(outcome, false)),
      enterTree: (title, view) => {
        s.setScoped({ scope: treeScope(title, view), alone: false });
        restart("");
      },
    },
    viewMeasures,
  );
  const searched = foundSections({ props, s, m, clock, files: filesState, index });
  const { assembled, inOutside } = assemble(props, s, ext, searched);
  // Whatever added rows (providers, agents), the list fits the panel at the text size (launcher/lib/fit.ts).
  const sections = fitToRoom(assembled, { height: m.room, row: m.row, head: m.head });
  const verbsOf = (row: Row): Verb[] => (scope ? scope.verbs(row, text) : verbsFor(row, ctx));
  if (working !== null) logTiming("rows worked out", performance.now() - working, BUDGET.instantMs);
  const typedAt = useKeystrokeTiming(query);
  // A scope the launcher leaves (or closes over) hears it: an extension's view is told to close.
  useEffect(() => () => scope?.leave?.(), [scope]);
  // A scope that changes the field itself, after any render (an extension's pushed view starts empty: tree-scope.ts).
  useEffect(() => {
    const next = scope?.fieldNow?.(query);
    if (next !== null && next !== undefined) restart(next);
  });
  const rows = selectable(sections);
  const rowIds = rows.map((row) => row.id);
  // With nothing held the first row, but never Ask: it is chosen, not given.
  const selected = held !== null && rowIds.includes(held) ? held : firstChoice(rowIds);
  const selectedRow = rows.find((row) => row.id === selected);
  const grid = mode.kind === "search" && sections.some((section) => section.grid !== undefined && section.rows.some((row) => row.id === selected));
  const pictures = useRowPictures(props, keys, selectedRow, world, mode.kind === "search" && !scope && !inOutside, grid);
  const say = (outcome: Outcome) => s.setNotice(outcome.ok ? { text: outcome.text, ok: true } : { text: outcome.error, ok: false });
  const sayDone = (words: string, ok = true) => s.setNotice({ text: words, ok });
  const finish = (stay: boolean) => {
    if (!stay) onClose();
  };
  const ran = (outcome: Outcome, stay: boolean) => {
    if (ext.shown(outcome)) return;
    if (outcome.ok) finish(stay);
    else say(outcome);
  };
  const restart = (next: string) => {
    typedAt.current = timingNow();
    pictures.fold();
    s.setQuery(next);
    s.setHeld(null);
    s.setAllApps(false);
    s.setFailed(null);
    s.setNotice(null);
  };
  return { text, ctx, ext, inOutside, sections, rows, selected, selectedRow, pictures, verbsOf, restart, ran, say, sayDone, finish };
}

/**
 * From outside Dashi: a command's answer on top and providers' rows below the rest; in a command's own
 * scope (a pick, a view, its words) only its rows (launcher/lib/extensions.ts). A scope has its own rows only,
 * and so does a command from outside. Otherwise agents' rows go around the rest, never between them: Now on
 * top of an empty field, Ask Dashi last (launcher/lib/agents/agent-rows.ts).
 */
function assemble(props: LauncherProps, s: LauncherState, ext: Extensions, searched: Section[]) {
  const { query, scope, allApps, agents } = s;
  const outside = ext.sections(searched);
  const inOutside = ext.chip !== undefined;
  const assembled = scope
    ? scope.sections(query)
    : inOutside
      ? outside
      : withAgents(outside, {
          query,
          allApps,
          snapshot: agents,
          tabbed: s.tabbed !== null && s.tabbed === query.trim(),
          ...(props.agents ? { history: props.agents.history } : {}),
          now: Math.floor(Date.now() / 1000),
          model: props.dashi?.model() ?? null,
          ...(props.dashi ? { name: props.dashi.name() } : {}),
        });
  return { assembled, inOutside };
}

/** Keystroke → its rows committed (and so sent to the host), with DASHI_LAUNCHER_TIMING=1 (launcher/timing.ts). */
function useKeystrokeTiming(query: string): { current: number | null } {
  const typedAt = useRef<number | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: it runs once each typed query is committed, which is the moment it times
  useEffect(() => {
    if (typedAt.current === null) return;
    logTiming("keystroke → rows sent", performance.now() - typedAt.current, BUDGET.keystrokeMs);
    typedAt.current = null;
  }, [query]);
  return typedAt;
}

/** The selected row's windows, live under it after → (launcher/pictures.ts); not in a scope, whose rows are its own. */
function useRowPictures(
  props: LauncherProps,
  keys: LauncherProps["keys"],
  selectedRow: Row | undefined,
  world: WorldSnapshot,
  searching: boolean,
  grid: boolean,
) {
  const arrows = useMemo(() => (keys?.arrows ? (want: ArrowsWanted) => keys.arrows?.(want) : undefined), [keys]);
  return usePictures({
    selectedRow,
    windows: world.windows,
    searching,
    grid,
    ...(arrows ? { arrows } : {}),
    ...(props.onPictures ? { onPictures: props.onPictures } : {}),
  });
}
