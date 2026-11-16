/**
 * The launcher's Store (store-v2 L15, L16): "Store" in the launcher opens a
 * scope of Dashi's add-ons (launcher extensions first, then menu bar
 * applets, then what is installed), and an add-on installs without leaving.
 * ↩ on one that isn't installed asks in place, in one line that says what it
 * adds and what it can reach (D328: the launcher's question, not the
 * Store's sheet; ↩ again gets it), and "Find in the Store" opens the Store
 * window on the words for apps. A grant is the person's own press: agents
 * never reach this scope (it is the person's launcher).
 */

import { showsOf } from "@dashi/applet";
import { type ActionContext, type ActionDef, type ActionSource, ok, ready } from "../actions/index.ts";
import { KEYS, type LauncherScope, type Row, type ScopeResult, type Section, type Verb } from "../launcher/index.ts";
import { abilityLines, commandsLine, type StoreApplet } from "../shared/applet-store/index.ts";
import type { AddOns } from "./add-ons.ts";

export const STORE_ADDRESS = "dashi://store/add-ons";

/** The Store's glyph: a bag (16-unit grid). */
export const STORE_GLYPH =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M3 5.4h10l-.8 8.2H3.8zM5.6 5.4V4.2a2.4 2.4 0 0 1 4.8 0v1.2" stroke="#000" stroke-width="1.4" fill="none" stroke-linejoin="round"/></svg>';

export interface StoreScopeDeps {
  addOns: Pick<AddOns, "subscribe" | "getSnapshot" | "refresh" | "status" | "install">;
  /** Opens the Store window on a search (apps live there). */
  openStore(query: string): void;
}

const verb = (id: string, title: string, extra: Partial<Verb> = {}): Verb => ({ id, title, effect: { kind: "scope", verb: id }, ...extra });

const matches = (entry: StoreApplet, words: string[]): boolean => {
  const hay = `${entry.manifest.name} ${entry.manifest.summary} ${entry.manifest.author.name} ${entry.manifest.id}`.toLowerCase();
  return words.every((word) => hay.includes(word));
};

/** What an add-on adds and can reach, in one line (the in-place question). */
export function getQuestion(entry: StoreApplet): string {
  const adds = commandsLine(entry.manifest);
  const can = abilityLines(entry.manifest);
  const reach =
    can.length > 0
      ? `It can: ${can.map((line, at) => (at === 0 ? line : line.charAt(0).toLowerCase() + line.slice(1))).join("; ")}.`
      : "It reaches nothing of yours.";
  const review = entry.reviewed ? "" : " Nobody at Dashi has read this version’s code.";
  return `Get “${entry.manifest.name}”? ${adds ? `${adds}. ` : ""}${reach}${review} ↩ again gets it.`;
}

function row(entry: StoreApplet, state: "get" | "installed" | "update" | "busy"): Row {
  const commands = entry.manifest.commands.length;
  const detail = [
    entry.reviewed ? "Reviewed by Dashi" : "Not reviewed",
    commands > 0 ? `${commands} ${commands === 1 ? "command" : "commands"}` : "Menu bar applet",
  ].join(" · ");
  const kind = { get: "Get", installed: "Installed", update: "Update", busy: "Installing…" }[state];
  return { id: `addon:${entry.manifest.id}`, title: entry.manifest.name, detail, kind, icon: { glyph: STORE_GLYPH }, action: { kind: "scope", verb: "show" } };
}

/** The scope's rows for what is typed: extensions, applets, installed; and a row to look for apps in the Store window. */
export function storeSections(deps: StoreScopeDeps, query: string): Section[] {
  const { entries, installing } = deps.addOns.getSnapshot();
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const found = (entries ?? []).filter((entry) => matches(entry, words));
  const stateOf = (entry: StoreApplet): "get" | "installed" | "update" | "busy" => {
    if (installing === entry.manifest.id) return "busy";
    const status = deps.addOns.status(entry).kind;
    return status === "update" ? "update" : status === "get" ? "get" : "installed";
  };
  const fresh = found.filter((entry) => stateOf(entry) !== "installed");
  const have = found.filter((entry) => stateOf(entry) === "installed");
  const sections: Section[] = [
    {
      id: "store:extensions",
      title: "Launcher extensions",
      aside: "from the Store",
      rows: fresh.filter((each) => showsOf(each.manifest).includes("launcher")).map((each) => row(each, stateOf(each))),
    },
    {
      id: "store:applets",
      title: "Menu bar applets",
      rows: fresh.filter((each) => !showsOf(each.manifest).includes("launcher")).map((each) => row(each, stateOf(each))),
    },
    { id: "store:installed", title: "Installed", rows: have.map((each) => row(each, "installed")) },
  ].filter((section) => section.rows.length > 0);
  const find: Row = {
    id: "store:find",
    title: query.trim() ? `Find “${query.trim()}” in the Store` : "Open the Store",
    kind: "Apps",
    icon: { glyph: STORE_GLYPH },
    action: { kind: "scope", verb: "find" },
  };
  return [...sections, { id: "store:apps", title: entries === null ? "Reading the catalog…" : "Apps", rows: [find] }];
}

export function storeScope(deps: StoreScopeDeps): LauncherScope {
  const entryOf = (rowId: string | undefined): StoreApplet | undefined =>
    rowId?.startsWith("addon:") ? deps.addOns.getSnapshot().entries?.find((each) => each.manifest.id === rowId.slice(6)) : undefined;
  return {
    id: "store",
    address: STORE_ADDRESS,
    chip: { title: "Store", icon: { glyph: STORE_GLYPH } },
    placeholder: "Search add-ons",
    // Read again each time the scope opens: the Store window may have got or removed one since.
    subscribe: (listener) => {
      void deps.addOns.refresh().catch(() => {});
      return deps.addOns.subscribe(listener);
    },
    getSnapshot: deps.addOns.getSnapshot,
    sections: (query) => storeSections(deps, query),
    verbs(row) {
      if (row.id === "store:find") return [verb("find", row.title, { key: KEYS.primary })];
      const entry = entryOf(row.id);
      if (!entry) return [];
      const status = deps.addOns.status(entry).kind;
      if (status === "get" || status === "update") {
        return [verb("get", status === "get" ? "Get" : "Update", { key: KEYS.primary, confirm: getQuestion(entry) }), verb("show", "Show in the Store")];
      }
      return [verb("show", "Show in the Store", { key: KEYS.primary })];
    },
    hints(row) {
      if (row?.id === "store:find") return [{ keys: KEYS.primary, label: "Open" }];
      const entry = entryOf(row?.id);
      if (!entry) return [];
      const kind = deps.addOns.status(entry).kind;
      return [{ keys: KEYS.primary, label: kind === "get" ? "Get" : kind === "update" ? "Update" : "Show" }];
    },
    async run(id, row, query): Promise<ScopeResult> {
      if (id === "find") {
        deps.openStore(query.trim());
        return { close: true };
      }
      const entry = entryOf(row?.id);
      if (!entry) return {};
      if (id === "show") {
        deps.openStore(entry.manifest.name);
        return { close: true };
      }
      if (id !== "get") return {};
      const failure = await deps.addOns.install(entry);
      return failure === null ? { notice: { text: `${entry.manifest.name} is in`, ok: true } } : { notice: { text: "Couldn’t get it", ok: false } };
    },
  };
}

/** "Store" in the launcher: the registry's `store` source; choosing it enters the scope in place. */
export function storeSource(open: (ctx: ActionContext) => void): ActionSource {
  const action: ActionDef = {
    address: STORE_ADDRESS,
    // Not "Store": the launcher lists no command named as an app is, and the Store app is "Store" (launcher/lib/items.ts).
    title: "Get Add-ons",
    description: "",
    properties: {},
    scope: null,
    readOnly: true,
    destructive: false,
    who: "person",
    source: "store",
    keywords: { en: ["store", "add-ons", "addons", "extensions", "launcher extensions", "applets", "get", "install", "software"] },
    kind: "open",
    check: () =>
      ready(async (ctx) => {
        open(ctx);
        return ok("The Store is open in the launcher.");
      }),
  };
  return { id: "store", actions: () => [action] };
}
