/**
 * What the launcher searches, as one list for the ranking (ranking/): the
 * installed apps and Settings panes (entries.ts), the open windows, and the
 * person's actions from the registry (actions/): every setting with state,
 * Dashi's own commands, the apps' Desktop Actions, the menus running apps
 * publish, and the agents' tools a person uses as commands. Each item keeps
 * its `dashi://` address, for Copy Address, an alias, or a key.
 *
 * The registry also holds the apps and the panes; those come from the
 * entries, which carry what a row draws (icons, glyphs, localized names), so
 * nothing is listed twice. A window title or a menu label is text another
 * program chose: shown and found by, never ranked above an exact name
 * (`foreign`).
 */

import { isSegment } from "../../actions/address.ts";
import type { ActionDef } from "../../actions/types.ts";
import { SETTINGS_APP_ID } from "../../apps.ts";
import type { Entry } from "../../entries.ts";
import { type EntryItem, entryItem } from "../ranking/entries.ts";
import { fold } from "../ranking/fold.ts";
import type { RankItem, RankKind } from "../ranking/item.ts";
import { buildIndex, type RankIndex } from "../ranking/rank-index.ts";

/** An open window, named the way the switcher names it (switcher/model.ts groups them, most recent app first). */
export interface LauncherWindow {
  id: number;
  /** `dashi://window/w3`: choosing it runs the registry's action, as the person. */
  address: string;
  /** Its title as its app set it (may be empty). */
  title: string;
  /** What the Dock calls its app. */
  appName: string;
  /** The launcher entry of its app, when one is installed. */
  entryId: string | null;
  state: "normal" | "minimized" | "hidden";
  /** The Desktop it is on, when that is not the one showing ("Desktop 2"). */
  desktop?: string;
  icon: string;
}

export interface LauncherItem extends RankItem {
  entry?: Entry;
  action?: ActionDef;
  window?: LauncherWindow;
  /** Its `dashi://` address, when it has one. */
  address?: string;
}

/** The address of an app or a pane entry: what the registry's apps and settings sources give it. */
export function entryAddress(entry: Pick<Entry, "id">): string | undefined {
  if (isPane(entry)) {
    const pane = entry.id.slice(SETTINGS_APP_ID.length + 1);
    return isSegment(pane) ? `dashi://settings/${pane}` : undefined;
  }
  return isSegment(entry.id) ? `dashi://app/${entry.id}` : undefined;
}

/** A Settings pane's entry id, `dev.dashi.settings/<pane>`. */
export const isPane = (entry: Pick<Entry, "id">): boolean => entry.id.startsWith(`${SETTINGS_APP_ID}/`);

/** An open window's address. */
export const windowAddress = (id: number): string => `dashi://window/w${id}`;

const WINDOW_ADDRESS = /^dashi:\/\/window\/w\d+$/;

/** What kind of row a registry action is, or null for one the launcher lists another way (or not at all). */
export function actionKind(action: ActionDef): RankKind | null {
  switch (action.source) {
    // The apps themselves are entries; their Desktop Actions are commands of theirs.
    case "apps":
      return action.address.includes("/action/") ? "command" : null;
    // The panes are entries; a setting's own row is the registry's.
    case "settings":
    case "controls":
      return action.place?.row !== undefined ? "setting" : null;
    // Clipboard History and Snippets are commands; the history's switch is a setting (clipboard/lib/actions.ts).
    case "clipboard":
      return action.place?.row !== undefined ? "setting" : "command";
    // Open windows come with their apps' names (LauncherWindow); arranging the focused one is a command.
    case "windows":
      return WINDOW_ADDRESS.test(action.address) ? null : "command";
    case "menus":
      return "menu";
    case "dashi":
      return "command";
    // An agent tool that needs an argument waits for a link to fill it in (the presenter): no row of its own.
    // One that only reads (list_windows, get_settings) answers a model, not a person: no row either;
    // nor one that takes arguments at all (set_volume's level), which a row can't give it.
    case "tools":
      return action.who === "both" && !action.readOnly && (action.required ?? []).length === 0 && Object.keys(action.properties ?? {}).length === 0
        ? "command"
        : null;
    default:
      return "command";
  }
}

/** "screenshot..." → "screenshot": a command that opens something ends in an ellipsis its app's name doesn't have. */
const withoutEllipsis = (folded: string): string => folded.replace(/\.\.\.$/, "");

/** Every word a registry action is found by, in any language. */
const actionWords = (action: ActionDef): string[] => Object.values(action.keywords).flat();

export interface ItemSources {
  entries: readonly Entry[];
  /** The registry's actions the person may use (`registry.list({ who: "person" })`). */
  actions?: readonly ActionDef[];
  windows?: readonly LauncherWindow[];
  /** The person's languages (shared/locale/messages.ts `languagesOf`). */
  languages?: readonly string[];
}

/** The launcher's items: entries first, then windows, then the actions not already listed under another name. */
export function launcherItems(sources: ItemSources): LauncherItem[] {
  const languages = sources.languages ?? [];
  const items: LauncherItem[] = [];
  const named = new Set<string>();
  for (const entry of sources.entries) {
    if (entry.hidden) continue;
    const item: EntryItem & LauncherItem = entryItem(entry, languages);
    const address = entryAddress(entry);
    items.push(address ? { ...item, address } : item);
    // Apps only: a Settings pane and a command may share a name (Lock Screen), and both are rows.
    if (item.kind === "app") named.add(fold(entry.name));
  }
  for (const window of sources.windows ?? []) {
    items.push({
      id: window.address,
      kind: "window",
      names: [window.title.trim() || window.appName],
      keywords: [window.appName, "window"],
      foreign: true,
      window,
      address: window.address,
    });
  }
  const seen = new Set<string>();
  // An agent tool that is also one of Dashi's commands (dashi://tool/lock-screen, dashi://dashi/lock-screen) is one row: Dashi's.
  const commands = new Set((sources.actions ?? []).filter((action) => action.source === "dashi").map((action) => action.address.split("/").pop()));
  const firstParty = firstPartyNames(sources);
  for (const given of sources.actions ?? []) {
    const action = outsideName(given, firstParty);
    const kind = actionKind(action);
    if (kind === null || seen.has(action.address)) continue;
    if (action.source === "tools" && commands.has(action.address.split("/").pop())) continue;
    // "System Settings" from the Dashi menu is the System Settings app, and "Screenshot…" the Screenshot app: one row.
    if (kind === "command" && action.from === undefined && named.has(withoutEllipsis(fold(action.title)))) continue;
    seen.add(action.address);
    // A menu row answers to its own words ("New Note"); its app and menu only narrow ("notes new").
    const path = kind === "menu" ? action.title.split(" › ") : [];
    items.push({
      id: action.address,
      kind,
      ...(kind === "menu" && path.length > 1
        ? { names: [path[path.length - 1] as string], keywords: [], qualifiers: path.slice(0, -1) }
        : { names: [action.title], keywords: actionWords(action) }),
      // A menu label, or a row from outside Dashi (an applet's, a script's): never above an exact app or setting.
      ...(kind === "menu" || action.from !== undefined ? { foreign: true } : {}),
      ...(action.source === "dashi" || action.source === "settings" || action.source === "controls" || action.source === "clipboard" ? { own: true } : {}),
      action,
      address: action.address,
    });
  }
  return items;
}

/** The names Dashi's own rows go by: its apps, its commands, its settings (folded). */
function firstPartyNames(sources: ItemSources): Set<string> {
  const own = (sources.actions ?? []).filter((action) => action.from === undefined && ["dashi", "settings", "controls", "tools"].includes(action.source));
  return new Set([
    ...sources.entries.filter((entry) => entry.shell || entry.id.startsWith("dev.dashi.")).map((entry) => fold(entry.name)),
    ...own.map((action) => fold(action.title)),
  ]);
}

/** A row from outside Dashi can't take a first-party name: "System Settings" from Weather reads "Weather › System Settings". */
export function outsideName(action: ActionDef, firstParty: ReadonlySet<string>): ActionDef {
  if (action.from === undefined || !firstParty.has(fold(action.title))) return action;
  return { ...action, title: `${action.from} › ${action.title}` };
}

let cached: { key: readonly unknown[]; index: RankIndex<LauncherItem> } | null = null;

/**
 * The ranking index over `sources`, built again only when one of them is a
 * new list: the launcher reopening over the same apps, windows and actions
 * builds nothing.
 */
export function launcherIndex(sources: ItemSources): RankIndex<LauncherItem> {
  const key = [sources.entries, sources.actions, sources.windows, sources.languages?.join(",")];
  if (cached && cached.key.length === key.length && cached.key.every((value, index) => value === key[index])) return cached.index;
  const index = buildIndex(launcherItems(sources));
  cached = { key, index };
  return index;
}

/** The windows of the app `entryId` names, most recent first. */
export function windowsOf(windows: readonly LauncherWindow[], entryId: string): LauncherWindow[] {
  return windows.filter((window) => window.entryId === entryId);
}
