/**
 * What can be done with a row (betterments.html, "Actions on a result",
 * recommendation B): its verbs, each with the key that does it without the
 * list. ❖K (or a right-click) turns the launcher's rows into these in place;
 * ↩ is the first, ❖↩ the second (New window), ⌥↩ the third (Bring here,
 * Show in Files), ❖C copies (the answer, the path, the address). Every list
 * ends with Copy Address and Reset Ranking. Pure, so the tests read it.
 *
 * Destructive verbs are drawn in the critical color. They ask in place,
 * where work could be lost and nothing else will ask: quitting an app with
 * several windows, moving a file to the Trash. Closing one window doesn't:
 * its app asks about unsaved work itself.
 */

import type { ActionDef, Args } from "../actions/types.ts";
import type { Entry } from "../entries.ts";
import { agentVerbs } from "./agents/rows.ts";
import { isPane, type LauncherItem, type LauncherWindow, windowsOf } from "./items.ts";
import { startsWithCommand } from "./ranking/commands.ts";
import { type FileRow, type Row, type RowAction, shownName } from "./row-model.ts";

/** The keys, as rows show them. */
export const KEYS = {
  primary: "↩",
  secondary: "❖↩",
  third: "⌥↩",
  copy: "❖C",
  flip: "Space",
  quit: "❖Q",
  alias: "⇧❖A",
  shortcut: "⇧❖K",
  actions: "❖K",
} as const;

export type Effect =
  | RowAction
  | { kind: "new-window"; entry: Entry }
  | { kind: "bring-here"; window: LauncherWindow }
  | { kind: "minimize"; window: LauncherWindow }
  | { kind: "close"; window: LauncherWindow }
  | { kind: "quit"; name: string; windows: readonly LauncherWindow[] }
  /** Flip a setting's switch in the row. */
  | { kind: "toggle"; item: LauncherItem }
  /** Run a registry action with these arguments (a link's, filled in). */
  | { kind: "run-args"; action: ActionDef; args: Args }
  | { kind: "show-in-files"; file: FileRow }
  | { kind: "trash"; file: FileRow }
  | { kind: "pin"; entry: Entry; pin: boolean }
  | { kind: "alias"; address: string; title: string }
  | { kind: "unalias"; address: string }
  | { kind: "shortcut"; address: string; title: string }
  | { kind: "unshortcut"; address: string }
  | { kind: "forget"; id: string }
  | { kind: "forget-all" };

export interface Verb {
  id: string;
  title: string;
  /** The key that does it without the list (KEYS). */
  key?: string;
  effect: Effect;
  /** Drawn in the critical color. */
  danger?: true;
  /** Asked in place first: the row says this, and ↩ again goes ahead. */
  confirm?: string;
  /** A key it is about, drawn after the title (the person's shortcut). */
  chord?: string;
}

export interface VerbContext {
  windows: readonly LauncherWindow[];
  /** The registry's actions: an app's Desktop Actions are verbs of its own. */
  actions?: readonly ActionDef[];
  /** The person's alias for an address, and the key they bound to it (as glyphs). */
  aliasOf?(address: string): string | undefined;
  keyOf?(address: string): string | undefined;
  /** Whether the app is kept in the Dock; null when the Dock can't keep it. */
  pinned?(entry: Entry): boolean | null;
}

const verb = (id: string, title: string, effect: Effect, extra: Partial<Verb> = {}): Verb => ({ id, title, effect, ...extra });

/** The id ranking history is kept under for a row (ranking/store.ts): an app's id, an address, a file's URL. */
export function historyId(row: Row): string | null {
  if (row.item) return row.item.id;
  if (row.action.kind === "open") return row.action.entry.id;
  if (row.action.kind === "open-file") return row.action.file.url;
  return null;
}

/** Copy Address, Set alias…, Set shortcut…, as the person has them now. */
function addressVerbs(address: string, title: string, ctx: VerbContext): Verb[] {
  const alias = ctx.aliasOf?.(address);
  const key = ctx.keyOf?.(address);
  return [
    verb("alias", alias ? `Change alias “${alias}”…` : "Set alias…", { kind: "alias", address, title }, { key: KEYS.alias }),
    ...(alias ? [verb("unalias", `Remove alias “${alias}”`, { kind: "unalias", address })] : []),
    verb("shortcut", key ? "Change shortcut…" : "Set shortcut…", { kind: "shortcut", address, title }, { key: KEYS.shortcut, ...(key ? { chord: key } : {}) }),
    ...(key ? [verb("unshortcut", "Remove shortcut", { kind: "unshortcut", address }, { chord: key })] : []),
    verb("copy-address", "Copy Address", { kind: "copy", text: address }, { key: KEYS.copy }),
  ];
}

const resetVerbs = (row: Row): Verb[] => {
  const id = historyId(row);
  return [
    ...(id ? [verb("forget", "Reset Ranking", { kind: "forget", id } satisfies Effect)] : []),
    verb("forget-all", "Reset All Ranking", { kind: "forget-all" }),
  ];
};

/** "Quit Files"; it asks first when more than one window would close. */
function quitVerb(name: string, windows: readonly LauncherWindow[]): Verb {
  return verb(
    "quit",
    `Quit ${name}`,
    { kind: "quit", name, windows },
    { key: KEYS.quit, danger: true, ...(windows.length > 1 ? { confirm: `Quit ${name} and close its ${windows.length} windows?` } : {}) },
  );
}

function appVerbs(entry: Entry, row: Row, ctx: VerbContext): Verb[] {
  const name = shownName(entry);
  const windows = windowsOf(ctx.windows, entry.id);
  const [front] = windows;
  const own = (ctx.actions ?? []).filter((action) => action.source === "apps" && action.address.startsWith(`dashi://app/${entry.id}/action/`));
  const pinned = ctx.pinned?.(entry) ?? null;
  const verbs: Verb[] = front
    ? [
        verb("switch", "Switch to window", { kind: "focus", window: front }, { key: KEYS.primary }),
        verb("new-window", "New window", { kind: "new-window", entry }, { key: KEYS.secondary }),
        ...(front.desktop ? [verb("bring-here", `Bring here from ${front.desktop}`, { kind: "bring-here", window: front }, { key: KEYS.third })] : []),
        ...windows
          .slice(1, 6)
          .map((window) => verb(`window:${window.id}`, `Switch to “${window.title.trim() || name}”`, { kind: "focus", window } satisfies Effect)),
      ]
    : [verb("open", "Open", { kind: "open", entry }, { key: KEYS.primary })];
  for (const action of own) {
    const item: LauncherItem = { id: action.address, kind: "command", names: [action.title], action, address: action.address };
    verbs.push(verb(`action:${action.address}`, action.title.split(" › ").at(-1) ?? action.title, { kind: "run", item }));
  }
  if (pinned !== null) verbs.push(verb("pin", pinned ? "Remove from Dock" : "Keep in Dock", { kind: "pin", entry, pin: !pinned }));
  const address = row.item?.address;
  if (address) verbs.push(...addressVerbs(address, name, ctx));
  if (front) verbs.push(quitVerb(name, windows));
  return [...verbs, ...resetVerbs(row)];
}

function windowVerbs(window: LauncherWindow, row: Row, ctx: VerbContext): Verb[] {
  const app = window.entryId ? windowsOf(ctx.windows, window.entryId) : [window];
  return [
    verb("switch", "Switch to window", { kind: "focus", window }, { key: KEYS.primary }),
    ...(window.desktop ? [verb("bring-here", `Bring here from ${window.desktop}`, { kind: "bring-here", window }, { key: KEYS.third })] : []),
    ...(window.state === "normal" ? [verb("minimize", "Minimize", { kind: "minimize", window } satisfies Effect)] : []),
    verb("copy-title", "Copy Title", { kind: "copy", text: row.title }, { key: KEYS.copy }),
    verb("close", "Close Window", { kind: "close", window }, { danger: true }),
    quitVerb(window.appName, app),
    ...resetVerbs(row),
  ];
}

function fileVerbs(file: FileRow, row: Row): Verb[] {
  return [
    verb("open", "Open", { kind: "open-file", file }, { key: KEYS.primary }),
    verb("show", "Show in Files", { kind: "show-in-files", file }, { key: KEYS.third }),
    verb("copy-path", "Copy Path", { kind: "copy", text: file.path }, { key: KEYS.copy }),
    verb("copy-address", "Copy Address", { kind: "copy", text: file.url }),
    verb("trash", "Move to Trash", { kind: "trash", file }, { danger: true, confirm: `Move “${file.name}” to the Trash?` }),
    ...resetVerbs(row),
  ];
}

/** A registry action's verbs: a setting opens at its row and flips with Space; a command or menu item runs. */
function actionVerbs(item: LauncherItem, row: Row, ctx: VerbContext): Verb[] {
  const action = item.action as ActionDef;
  const lead: Verb[] =
    item.kind === "setting"
      ? [
          verb("reveal", "Open in Settings", { kind: "reveal", item }, { key: KEYS.primary }),
          ...(row.control?.kind === "switch"
            ? [verb("toggle", row.control.on ? `Turn ${action.title} off` : `Turn ${action.title} on`, { kind: "toggle", item }, { key: KEYS.flip })]
            : []),
        ]
      : [verb("run", action.title.split(" › ").at(-1) ?? action.title, { kind: "run", item }, { key: KEYS.primary })];
  return [...lead, ...addressVerbs(action.address, action.title, ctx), ...resetVerbs(row)];
}

/** Every verb for `row`, the first being what ↩ does. */
export function verbsFor(row: Row, ctx: VerbContext): Verb[] {
  const item = row.item;
  const action = row.action;
  if (item?.window) return windowVerbs(item.window, row, ctx);
  if (item?.action) return actionVerbs(item, row, ctx);
  const entry = item?.entry ?? (action.kind === "open" ? action.entry : undefined);
  if (entry && !isPane(entry)) return appVerbs(entry, row, ctx);
  if (entry) {
    const address = item?.address;
    return [
      verb("open", "Open", { kind: "open", entry }, { key: KEYS.primary }),
      ...(address ? addressVerbs(address, shownName(entry), ctx) : []),
      ...resetVerbs(row),
    ];
  }
  if (action.kind === "open-file") return fileVerbs(action.file, row);
  if (action.kind === "copy") return [verb("copy", "Copy", action, { key: KEYS.primary })];
  if (action.kind === "agent") return agentVerbs(action.act);
  return [verb("do", row.title, action, { key: KEYS.primary })];
}

/** A link's action, shown with its arguments filled in: Return runs it, nothing else does (actions/run.ts). */
export function presentedVerbs(action: ActionDef, args: Args, ctx: VerbContext): Verb[] {
  const checked = action.check(args);
  return [
    ...(checked.ok
      ? [verb("run", action.title, { kind: "run-args", action, args }, { key: KEYS.primary, ...(action.destructive ? { danger: true } : {}) })]
      : []),
    ...addressVerbs(action.address, action.title, ctx).filter((each) => each.id === "copy-address"),
  ];
}

/** A verb as a row of the action list: its title, its key at the right. */
export function verbRow(each: Verb, asking: boolean): Row {
  return {
    id: `verb:${each.id}`,
    title: asking && each.confirm ? each.confirm : each.title,
    kind: "",
    icon: { none: true },
    action: { kind: "type", query: "" },
    ...(each.key ? { shortcut: asking ? KEYS.primary : each.key } : {}),
    ...(each.chord ? { chord: each.chord } : {}),
    ...(each.danger ? { danger: true as const } : {}),
  };
}

/**
 * Whether Space flips the selected row's switch rather than typing a space:
 * when the row has a switch and a space can't be the next letter of its
 * name or words ("wif" then Space flips Wi-Fi; "dark" then Space types on
 * to "dark mode"; "dark mode" then Space flips it). Never in words that
 * start with a command's verb ("turn on dark", "turn on dark mode", which
 * may go on "and email alexk"): that is a sentence being typed, and Return
 * flips it (ranking/commands.ts).
 */
export function spaceFlips(row: Row | undefined, query: string): boolean {
  if (row?.control?.kind !== "switch" || query.trim() === "" || startsWithCommand(query)) return false;
  const typed = `${query.toLowerCase()} `;
  const words = [row.title, ...(row.item?.keywords ?? [])].map((word) => word.toLowerCase());
  return !words.some((word) => word.startsWith(typed));
}

/** The verb `key` does on `row` without the list, if it does one. */
export function verbForKey(row: Row, key: string, ctx: VerbContext): Verb | undefined {
  return verbsFor(row, ctx).find((each) => each.key === key);
}

/** The verbs whose title has `filter`, in order (the field filters the action list). */
export function filterVerbs(verbs: readonly Verb[], filter: string): Verb[] {
  const words = filter.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...verbs];
  return verbs.filter((each) => {
    const title = each.title.toLowerCase();
    return words.every((word) => title.includes(word));
  });
}

/** One hint at the field's right end: the keys (drawn as glyphs) and what they do. */
export interface Hint {
  keys: string;
  label: string;
}

/** Short words for a hint: "Switch", not "Switch to window". */
const SHORT: Readonly<Record<string, string>> = { "Switch to window": "Switch", "Open in Settings": "Open" };

/** What the field's right end says for the selected row: its keys, so they are learned. The answer's row says it in place. */
export function hintFor(row: Row | undefined, ctx: VerbContext): Hint[] {
  if (!row || row.action.kind === "copy") return [];
  const verbs = verbsFor(row, ctx);
  const [first] = verbs;
  const flip = verbs.find((each) => each.key === KEYS.flip);
  const second = verbs.find((each) => each.key === KEYS.secondary);
  return [
    ...(flip ? [{ keys: KEYS.flip, label: "toggles" }] : []),
    ...(first && (flip || second) ? [{ keys: KEYS.primary, label: SHORT[first.title] ?? first.title }] : []),
    ...(second ? [{ keys: KEYS.secondary, label: second.title }] : []),
    ...(verbs.length > 1 ? [{ keys: KEYS.actions, label: "Actions" }] : []),
  ];
}
