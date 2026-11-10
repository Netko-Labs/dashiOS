/**
 * The launcher's two clipboard scopes (launcher/types.ts): the history
 * ("Clipboard ›", ⌥❖V) and the snippets ("Snippets ›"). ↩ pastes into the
 * window that had the keyboard before the launcher opened, ❖C copies, and
 * the action list (❖K) has Pin, Delete and Clear History; the snippets'
 * field adds one (";addr Calle de la Luna 12" and ↩).
 */

import { KEYS, type LauncherScope, type ScopeResult, type Verb } from "../../launcher/index.ts";
import { CLIPBOARD, SNIPPET } from "../glyphs.ts";
import type { ClipboardHistory, ClipEntry } from "../history.ts";
import { historySections, snippetSections } from "./rows.ts";
import { parseAdd, type SnippetStore } from "./snippets.ts";

export const HISTORY_ADDRESS = "dashi://clipboard/history";
export const SNIPPETS_ADDRESS = "dashi://clipboard/snippets";

/** Where ↩ pastes: the window that had the keyboard before the launcher, by its app's name. */
export interface PasteTarget {
  id: number;
  appId: string;
  appName: string;
}

export interface ScopeDeps {
  history: ClipboardHistory;
  snippets: SnippetStore;
  enabled(): boolean;
  target(): PasteTarget | null;
  /** Hear that the target or the settings changed (the launcher opened over another window; history turned off). */
  onChange(listener: () => void): () => void;
  imagePath(entry: ClipEntry): string | null;
  paste(entry: ClipEntry, target: PasteTarget): Promise<boolean>;
  copy(entry: ClipEntry): Promise<boolean>;
  /** A snippet's text (placeholders filled in) into the target, or on the clipboard. */
  pasteSnippet(text: string, target: PasteTarget): Promise<boolean>;
  copySnippet(text: string): Promise<boolean>;
  openSettings(): void;
  now?(): number;
}

const verb = (id: string, title: string, extra: Partial<Verb> = {}): Verb => ({ id, title, effect: { kind: "scope", verb: id }, ...extra });

const pasteTitle = (target: PasteTarget | null): string => (target ? `Paste into ${target.appName}` : "Paste");

/** A store of several: the launcher draws again when any of them changes. */
function joined(stores: Array<{ subscribe(listener: () => void): () => void }>): LauncherScope["subscribe"] {
  return (listener) => {
    const offs = stores.map((store) => store.subscribe(listener));
    return () => {
      for (const off of offs) off();
    };
  };
}

/** A snapshot that is new whenever one of the parts `read` returns is. */
function versioned(read: () => readonly unknown[]): () => number {
  let serial = 0;
  let last: readonly unknown[] = [];
  return () => {
    const now = read();
    if (now.length !== last.length || now.some((part, at) => part !== last[at])) {
      last = now;
      serial++;
    }
    return serial;
  };
}

export function historyScope(deps: ScopeDeps): LauncherScope {
  const changes = { subscribe: deps.onChange };
  const entryOf = (rowId: string | undefined) => (rowId?.startsWith("clip:") ? deps.history.get(rowId.slice(5)) : undefined);
  return {
    id: "clipboard",
    address: HISTORY_ADDRESS,
    chip: { title: "Clipboard", icon: { glyph: CLIPBOARD } },
    placeholder: "Search copies",
    subscribe: joined([deps.history, changes]),
    getSnapshot: versioned(() => [deps.history.getSnapshot(), deps.target(), deps.enabled()]),
    sections: (query) =>
      historySections(deps.history.getSnapshot(), query, { now: deps.now?.() ?? Date.now(), enabled: deps.enabled(), imagePath: deps.imagePath }),
    verbs(row) {
      if (row.id === "clip:off") return [verb("settings", "Open Keyboard Settings", { key: KEYS.primary })];
      const entry = entryOf(row.id);
      if (!entry) return [];
      const count = deps.history.getSnapshot().entries.length;
      return [
        verb("paste", pasteTitle(deps.target()), { key: KEYS.primary }),
        verb("copy", "Copy", { key: KEYS.copy }),
        verb(entry.pinned ? "unpin" : "pin", entry.pinned ? "Unpin" : "Pin"),
        verb("delete", "Delete", { danger: true }),
        verb("clear", "Clear History", { danger: true, confirm: count === 1 ? "Clear the one copy kept?" : `Clear all ${count} copies, pinned ones too?` }),
      ];
    },
    hints(row) {
      if (!entryOf(row?.id)) return row?.id === "clip:off" ? [{ keys: KEYS.primary, label: "Open Settings" }] : [];
      return [
        { keys: KEYS.primary, label: pasteTitle(deps.target()) },
        { keys: KEYS.actions, label: "Actions" },
      ];
    },
    async run(id, row): Promise<ScopeResult> {
      if (id === "settings") {
        deps.openSettings();
        return { close: true };
      }
      const entry = entryOf(row?.id);
      if (!entry) return {};
      switch (id) {
        case "paste": {
          const to = deps.target();
          if (!to) return (await deps.copy(entry)) ? { notice: { text: "Copied", ok: true } } : { notice: { text: "Couldn't copy", ok: false } };
          void deps.paste(entry, to);
          return { close: true };
        }
        case "copy":
          return (await deps.copy(entry)) ? { notice: { text: "Copied", ok: true } } : { notice: { text: "Couldn't copy", ok: false } };
        case "pin":
        case "unpin":
          deps.history.pin(entry.id, id === "pin");
          return { notice: { text: id === "pin" ? "Pinned" : "Unpinned", ok: true } };
        case "delete":
          deps.history.delete(entry.id);
          return { notice: { text: "Deleted", ok: true } };
        case "clear":
          deps.history.clear();
          return { notice: { text: "History cleared", ok: true } };
        default:
          return {};
      }
    },
  };
}

export function snippetsScope(deps: ScopeDeps): LauncherScope {
  const changes = { subscribe: deps.onChange };
  const snippetOf = (rowId: string | undefined) => (rowId?.startsWith("snippet:") ? deps.snippets.find(rowId.slice(8)) : undefined);
  return {
    id: "snippets",
    address: SNIPPETS_ADDRESS,
    chip: { title: "Snippets", icon: { glyph: SNIPPET } },
    placeholder: "Search snippets, or add one: ;addr and its text",
    subscribe: joined([deps.snippets, changes]),
    getSnapshot: versioned(() => [deps.snippets.getSnapshot(), deps.target()]),
    sections: (query) => snippetSections(deps.snippets.getSnapshot(), query),
    verbs(row) {
      if (row.id === "snippet:add") return row.danger ? [] : [verb("add", row.title, { key: KEYS.primary })];
      if (!snippetOf(row.id)) return [];
      return [
        verb("paste", pasteTitle(deps.target()), { key: KEYS.primary }),
        verb("copy", "Copy Text", { key: KEYS.copy }),
        verb("delete", "Delete Snippet", { danger: true }),
      ];
    },
    hints(row) {
      if (row?.id === "snippet:add" && !row.danger) return [{ keys: KEYS.primary, label: "Add" }];
      return snippetOf(row?.id) ? [{ keys: KEYS.primary, label: pasteTitle(deps.target()) }] : [];
    },
    async run(id, row, query): Promise<ScopeResult> {
      if (id === "add") {
        const adding = parseAdd(query);
        if (!adding) return {};
        const problem = deps.snippets.add(adding);
        return problem ? { notice: { text: problem, ok: false } } : { query: "", notice: { text: `“${adding.keyword}” added`, ok: true } };
      }
      const snippet = snippetOf(row?.id);
      if (!snippet) return {};
      switch (id) {
        case "paste": {
          const to = deps.target();
          if (!to) return (await deps.copySnippet(snippet.text)) ? { notice: { text: "Copied", ok: true } } : { notice: { text: "Couldn't copy", ok: false } };
          void deps.pasteSnippet(snippet.text, to);
          return { close: true };
        }
        case "copy":
          return (await deps.copySnippet(snippet.text)) ? { notice: { text: "Copied", ok: true } } : { notice: { text: "Couldn't copy", ok: false } };
        case "delete":
          deps.snippets.remove(snippet.keyword);
          return { notice: { text: `“${snippet.keyword}” deleted`, ok: true } };
        default:
          return {};
      }
    },
  };
}
