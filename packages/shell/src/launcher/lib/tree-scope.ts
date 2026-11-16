/**
 * An extension's view as a launcher scope (types.ts `LauncherScope`), the
 * way the clipboard history is one: a chip names the command, its rows are
 * the launcher's own (tree-rows.ts), ❖K turns them into the item's actions in
 * place, Esc goes back a view and then out. The extension never draws: it
 * sends a tree (applets/views.ts keeps it) and hears what was chosen.
 *
 * - Until the first tree, the view's skeleton: three empty rows, "Loading…"
 *   after 300 ms, "<it> isn't answering" after 10 s.
 * - A `set` action asks for its preference in the field (a secret's field
 *   shows dots) and Return keeps it.
 * - A `push` action's view starts with an empty field: what was typed to
 *   find the row goes, what was typed after ↩ (before the view came) stays
 *   (pass 42: the repository's name filtered its pull requests away).
 */

import { findNode } from "@dashi/applet";
import type { TreeActed, TreeView } from "../../actions/index.ts";
import type { Row, RowIcon } from "../row-model.ts";
import type { Section } from "../sections.ts";
import type { LauncherScope, ScopeResult } from "../types.ts";
import { type Hint, KEYS, type Verb } from "../verbs.ts";
import { EXTENSION_GLYPH } from "./extension-rows.ts";
import { nodeIdOf, panelOf, panelVerbs, treeSections } from "./tree-rows.ts";

/** "Loading" shows after this long without a tree. */
export const LOADING_AFTER_MS = 300;

type Asking = Extract<TreeActed, { kind: "ask" }>;

const ANSWER = "answer";

/** A number for each snapshot object: the session makes a new one on every change. */
const seen = new WeakMap<object, number>();
let counter = 0;
function numberOf(snapshot: object): number {
  const known = seen.get(snapshot);
  if (known !== undefined) return known;
  seen.set(snapshot, ++counter);
  return counter;
}

/** A row that ran an action at a depth of the view's stack (the view it may have pushed is one deeper). */
interface Opened {
  depth: number;
  row: string;
  query: string;
}

class TreeScope {
  asking: Asking | null = null;
  /** The rows that opened the views on the stack, so Esc back selects the one that was opened (pass 37). */
  private opened: Opened[] = [];
  private wentBack: Opened | null = null;
  private searched: string | null = null;
  /** A push asked for and not yet come: the depth it was asked at, and what the field held then. */
  private pushing: { depth: number; query: string } | null = null;
  private serial = 0;
  private readonly own = new Set<() => void>();
  readonly icon: RowIcon;

  constructor(
    readonly title: string,
    readonly view: TreeView,
    private readonly now: () => number,
  ) {
    this.icon = view.icon ? { image: view.icon } : { glyph: EXTENSION_GLYPH };
  }

  private changed(): void {
    this.serial++;
    for (const listener of [...this.own]) listener();
  }

  private top() {
    return this.view.snapshot().stack.at(-1);
  }

  private note(id: string, words: string, detail?: string): Section[] {
    return [{ id: "tree:note", rows: [{ id, title: words, ...(detail ? { detail } : {}), kind: "", icon: this.icon, action: { kind: "type", query: "" } }] }];
  }

  subscribe = (listener: () => void): (() => void) => {
    this.own.add(listener);
    const off = this.view.subscribe(listener);
    return () => {
      this.own.delete(listener);
      off();
    };
  };

  snapshot = (): string => `${this.serial}:${numberOf(this.view.snapshot())}`;

  placeholder(): string {
    const words = this.top()?.p.placeholder;
    return this.asking ? this.asking.title : typeof words === "string" ? words : `Search ${this.title}`;
  }

  sections = (query: string): Section[] => {
    const { asking, view } = this;
    if (asking) {
      const typed = query.trim() ? (asking.secret ? "•".repeat(Math.min(query.length, 24)) : query.trim()) : asking.title;
      return this.note(`tree:${ANSWER}`, typed, "Return keeps it");
    }
    const state = view.snapshot();
    if (state.phase === "failed") return this.note("tree:failed", state.error ?? `${view.from} couldn't answer`);
    const root = this.top();
    if (!root) return this.now() - state.since > LOADING_AFTER_MS ? this.note("tree:loading", "Loading…") : [{ id: "tree:skeleton", rows: [], reserved: 3 }];
    // An extension that filters itself hears what is typed; the launcher filters the rest.
    // Nor while a view it pushes is on its way: keys typed for that view are not a new search here.
    if (root.p.filter === "extension" && this.searched !== query && !this.pushing) {
      this.searched = query;
      view.search(query);
    }
    return treeSections(root, query, { dir: view.dir, from: view.from });
  };

  verbs = (row: Row): Verb[] => {
    if (this.asking) return [{ id: ANSWER, title: `Keep ${this.asking.title}`, effect: { kind: "scope", verb: ANSWER }, key: KEYS.primary }];
    const root = this.top();
    const nodeId = nodeIdOf(row);
    if (!root || !nodeId) return [];
    const node = nodeId === root.i ? root : root.c.flatMap((child) => [child, ...child.c]).find((each) => each.i === nodeId);
    // The launcher's own rows (Loading…, "Nothing in … for …") have no actions: ↩ or ❖↩ typed before the
    // list came used to run the view's own (Choose Repository…, Use a GitHub Token…; passes 41 and 42).
    if (!node) return [];
    // The item's own actions, then the view's (its root's ActionPanel), each once.
    const own = panelVerbs(panelOf(node, root));
    const view = node === root ? [] : panelVerbs(root.c.find((child) => child.t === "ActionPanel")).filter((verb) => !own.some((each) => each.id === verb.id));
    return [...own, ...view.map(({ key: _key, ...verb }) => verb)];
  };

  // ↩ and ❖K only: the field keeps its room for what is typed (an extension's titles are long).
  hints = (row: Row | undefined): Hint[] => {
    const shown = row ? this.verbs(row) : [];
    const [first] = shown;
    return [
      ...(first ? [{ keys: first.key ?? KEYS.primary, label: first.title }] : []),
      ...(shown.length > 1 ? [{ keys: KEYS.actions, label: "Actions" }] : []),
    ];
  };

  run = async (verb: string, row: Row | undefined, query: string): Promise<ScopeResult> => {
    const wanted = this.asking;
    if (wanted) {
      this.asking = null;
      this.changed();
      const kept = await this.view.setPreference(wanted.name, query);
      return { query: "", notice: kept ? { text: `${wanted.title} kept`, ok: true } : { text: `Couldn't keep ${wanted.title}`, ok: false } };
    }
    // ↩ on a row is its first action.
    const id = verb === "first" ? (row ? this.verbs(row)[0]?.id : undefined) : verb;
    this.pushing = null;
    if (id && row) {
      const depth = this.view.snapshot().stack.length;
      this.opened = [...this.opened.filter((each) => each.depth < depth), { depth, row: row.id, query }];
      const top = this.top();
      if (top && findNode(top, id)?.p.kind === "push") this.pushing = { depth, query };
    }
    return id ? this.acted(await this.view.act(id)) : {};
  };

  private acted(done: TreeActed): ScopeResult {
    if (done.kind === "failed") return { notice: { text: done.error, ok: false } };
    if (done.kind === "ask") {
      this.asking = done;
      this.changed();
      return { query: "" };
    }
    return { ...(done.close ? { close: true as const } : {}), ...(done.notice ? { notice: { text: done.notice, ok: true } } : {}) };
  }

  /** What the field holds once a pushed view came: what was typed after ↩; null while nothing changes it. */
  fieldNow = (query: string): string | null => {
    const pushing = this.pushing;
    if (!pushing || this.view.snapshot().stack.length <= pushing.depth) return null;
    this.pushing = null;
    return query.startsWith(pushing.query) ? query.slice(pushing.query.length) : "";
  };

  back = (): boolean => {
    this.wentBack = null;
    this.pushing = null;
    if (!this.asking) {
      const depth = this.view.snapshot().stack.length;
      if (!this.view.back()) return false;
      // The view went back to the one a level up: the row that opened it there is selected again.
      this.wentBack = this.opened.find((each) => each.depth === depth - 1) ?? null;
      this.opened = this.opened.filter((each) => each.depth < depth - 1);
      return true;
    }
    this.asking = null;
    this.changed();
    return true;
  };

  returnTo = (): { row: string; query: string } | null => {
    const back = this.wentBack;
    this.wentBack = null;
    return back ? { row: back.row, query: back.query } : null;
  };
}

export function treeScope(title: string, view: TreeView, now: () => number = () => performance.now()): LauncherScope {
  const scope = new TreeScope(title, view, now);
  return {
    id: `tree:${view.from}:${title}`,
    address: "dashi://launcher/extension-view",
    chip: { title, icon: scope.icon },
    get placeholder() {
      return scope.placeholder();
    },
    // A new snapshot object for every tree, patch or toast (applets/lib/tree-session.ts), and a serial for the asking.
    subscribe: scope.subscribe,
    getSnapshot: scope.snapshot,
    sections: scope.sections,
    verbs: scope.verbs,
    hints: scope.hints,
    run: scope.run,
    back: scope.back,
    returnTo: scope.returnTo,
    fieldNow: scope.fieldNow,
    leave: () => view.close(),
    secure: () => scope.asking?.secret === true,
    notice: () => {
      const toast = view.snapshot().toast;
      return toast ? { text: toast.title, ok: toast.style !== "failed" } : null;
    },
  };
}
