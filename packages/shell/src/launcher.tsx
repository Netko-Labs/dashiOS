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
 */

import { useColors } from "@dashi/ui";
import { View } from "@mirinjs/metal";
import { type ReactNode, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Outcome } from "./actions/types.ts";
import { iconPath } from "./apps.ts";
import { useClockPrefs, usesHour24 } from "./clock.ts";
import type { Entry } from "./entries.ts";
import { BUDGET } from "./launcher/budget.ts";
import { aliasRows, aliasToKeep, mayKeep, shortcutRows } from "./launcher/editing.ts";
import { Field } from "./launcher/field.tsx";
import type { LauncherHost, LauncherPrefsStore, LauncherRanking, LauncherWorldStore, Presented } from "./launcher/host.ts";
import { launcherIndex } from "./launcher/items.ts";
import type { LauncherCommand } from "./launcher/keys.ts";
import { linkTitle } from "./launcher/link-args.ts";
import { chordWhen, collision } from "./launcher/person-keys.ts";
import type { LauncherPrefsSnapshot } from "./launcher/prefs.ts";
import { ReservedRows, ResultRow, SectionHead } from "./launcher/row-view.tsx";
import { buildSections, FILE_ROWS, type FileRow, fileNameMatches, filesStateFor, placeholderFor, type Row, type Section, selectable } from "./launcher/rows.ts";
import { keepInView, type Move, moveSelection, resolveSelection } from "./launcher/selection.ts";
import { logTiming, timingNow } from "./launcher/timing.ts";
import { applyEdits } from "./launcher/type-ahead.ts";
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
import type { WorldSnapshot } from "./launcher/world.ts";

export type { FileRow } from "./launcher/rows.ts";

/** The surface, and the measures of the panel on it (docs/design.html LA-1, TY-1, RA-1: the launcher's row). */
export const LAUNCHER = { width: 620, height: 520, field: 48, fieldText: 17, radius: 12, padding: 5 } as const;

/**
 * Files are asked as soon as the rows are drawn: one question at a time over one
 * LocalSearch connection, a newer one replacing one still waiting (file-search.ts),
 * so typing never queues them up, and they have 80 ms to fill their slots (launcher/budget.ts).
 */
export const FILE_DELAY_MS = 0;
/** Rows of All apps drawn at once; the selection scrolls them. */
const ALL_APPS_ROWS = 8;
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
  /** The list's height follows its rows over this many ms (a host that can: launcher/resident.tsx); unset jumps (Reduce Motion). */
  heightTransitionMs?: number;
  onClose: () => void;
}

const ICONS = { calculator: iconPath("calculator"), files: iconPath("files"), software: iconPath("software"), command: iconPath("settings") };

const NO_WORLD: WorldSnapshot = { actions: [], windows: [], serial: 0 };
const NO_PREFS: LauncherPrefsSnapshot = { aliases: new Map(), aliasOf: () => undefined, keyOf: () => undefined };
const noStore = { subscribe: () => () => {}, getSnapshot: () => NO_WORLD };
const noPrefs = { subscribe: () => () => {}, getSnapshot: () => NO_PREFS };

/** Where the launcher is: searching, a row's action list, giving an alias or a key, or a link's action. */
type Mode =
  | { kind: "search" }
  | { kind: "actions"; row: Row }
  | { kind: "alias"; address: string; title: string }
  | { kind: "shortcut"; address: string; title: string; when: string | null }
  | { kind: "presented"; presented: Presented };

export function Launcher(props: LauncherProps) {
  const { entries, recent = [], files, keys, onClose, host, ranking } = props;
  const colors = useColors();
  const world = useSyncExternalStore(props.world?.subscribe ?? noStore.subscribe, props.world?.getSnapshot ?? noStore.getSnapshot);
  const prefs = useSyncExternalStore(props.prefs?.subscribe ?? noPrefs.subscribe, props.prefs?.getSnapshot ?? noPrefs.getSnapshot);
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

  const text = query.trim();
  const filesState = filesStateFor({ query, offered: files !== undefined, off: filesOff, answer: found, lastCount: lastFileCount });
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
  const sections = buildSections({
    answers,
    query,
    entries,
    recent,
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
  const selected = resolveSelection(
    rows.map((row) => row.id),
    held,
  );
  const selectedRow = rows.find((row) => row.id === selected);

  // The action list, or what the alias and shortcut fields offer.
  const verbs: Verb[] =
    mode.kind === "actions"
      ? filterVerbs(verbsFor(mode.row, ctx), filter)
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
  const listIds = mode.kind === "search" ? rows.map((row) => row.id) : verbIds;

  const latest = useRef(listIds);
  latest.current = listIds;
  const mover = (how: Move) => {
    if (mode.kind === "search") setHeld((now) => moveSelection(latest.current, now, how));
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
    setQuery(next);
    setHeld(null);
    setAllApps(false);
    setFailed(null);
    setNotice(null);
  };

  const openActions = (row: Row | undefined) => {
    if (!row || verbsFor(row, ctx).length < 2) return;
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
    if (outcome.ok) finish(stay);
    else say(outcome);
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
      case "run":
        learn(row);
        if (effect.item.action) runOf(host?.run(effect.item.action));
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
        verbsFor(row, ctx).find((each) => each.key === key),
        row,
      );
  };

  const submit = (stay = false) => {
    switch (mode.kind) {
      case "search":
        return doVerb(selectedRow ? verbsFor(selectedRow, ctx)[0] : undefined, selectedRow, stay);
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
        if (row) doVerb(verbsFor(row, ctx)[0], row);
        return;
      }
      case "digits":
        return setDigits(cmd.shown);
      case "record":
        if (mode.kind === "shortcut") setMode({ ...mode, when: chordWhen(cmd.chord) });
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
      const flip = verbsFor(selectedRow, ctx).find((each) => each.key === KEYS.flip);
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
    // A link opened the launcher for its action alone: Esc closes it.
    if (mode.kind === "presented") return onClose();
    if (mode.kind !== "search") return backToSearch();
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
    if (section.id !== "all") return section.rows;
    const at = Math.max(
      0,
      section.rows.findIndex((row) => row.id === selected),
    );
    offset.current = keepInView(at, offset.current, ALL_APPS_ROWS, section.rows.length);
    return section.rows.slice(offset.current, offset.current + ALL_APPS_ROWS);
  };
  /** The rows on screen, top to bottom: what ❖1–9 pick. */
  function drawnRows(): Row[] {
    return sections.flatMap((section) => drawn(section));
  }
  const digitOf = new Map(
    digits && mode.kind === "search"
      ? drawnRows()
          .slice(0, 9)
          .map((row, at) => [row.id, at + 1] as const)
      : [],
  );

  let list: ReactNode = null;
  const listBox = (children: ReactNode) => (
    <View
      testID="launcher:list"
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
      sections.map((section) => (
        <View key={section.id} testID={`launcher:section:${section.id}`} style={{ flexDirection: "column" }}>
          {section.title !== undefined && <SectionHead title={section.title} {...(section.aside ? { aside: section.aside } : {})} />}
          {drawn(section).map((row) => (
            <ResultRow
              key={row.id}
              row={row}
              selected={row.id === selected}
              onPress={() => doVerb(verbsFor(row, ctx)[0], row)}
              onHover={() => setHeld(row.id)}
              onContextMenu={() => {
                setHeld(row.id);
                openActions(row);
              }}
              {...(digitOf.has(row.id) ? { digit: digitOf.get(row.id) as number } : {})}
            />
          ))}
          {section.reserved !== undefined && <ReservedRows count={section.reserved} />}
        </View>
      )),
    );
  } else if (mode.kind === "actions" || mode.kind === "presented") {
    list = listBox(
      <View testID="launcher:section:actions" style={{ flexDirection: "column" }}>
        {verbRows.map((row, at) => (
          <ResultRow
            key={row.id}
            row={row}
            selected={row.id === selectedVerbId}
            onPress={() => doVerb(verbs[at], mode.kind === "actions" ? mode.row : undefined)}
            onHover={() => setHeldVerb(row.id)}
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
  }

  const chip =
    mode.kind === "actions"
      ? { title: mode.row.title, icon: mode.row.icon }
      : mode.kind === "presented"
        ? { title: linkTitle(mode.presented.action, mode.presented.args) }
        : mode.kind === "alias"
          ? { title: `Alias for ${mode.title}` }
          : mode.kind === "shortcut"
            ? { title: `Shortcut for ${mode.title}` }
            : undefined;
  const placeholder =
    mode.kind === "search"
      ? placeholderFor(files !== undefined && !filesOff)
      : mode.kind === "alias"
        ? "An alias, like ff"
        : mode.kind === "shortcut"
          ? "Press the keys"
          : "Search actions";
  const hints =
    mode.kind === "search"
      ? text
        ? hintFor(selectedRow, ctx)
        : []
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
          {...(chip ? { chip } : {})}
          hints={hints}
          notice={notice}
          onChangeText={onChangeText}
          onSubmit={() => submit()}
          onKey={onKey}
        />
        {list}
      </View>
    </View>
  );
}
