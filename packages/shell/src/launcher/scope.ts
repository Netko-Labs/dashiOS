/**
 * A launcher scope: the same panel narrowed to one source's rows, with a
 * chip naming it ("Clipboard ›"), its own placeholder, its rows' verbs and
 * keys, and its own hints at the field's end. The clipboard history (⌥❖V)
 * and snippets are scopes (clipboard/scope.ts). Choosing the action at a
 * scope's `address` in the launcher enters it in place; a key or a link to
 * that address opens the launcher in it. Esc leaves it: back to the whole
 * launcher, or closed when it was opened for the scope alone.
 *
 * A scope's rows and verbs are pure reads of its store (`getSnapshot`); a
 * verb's effect is `{ kind: "scope", verb }`, which the launcher hands to
 * `run` with the row and what is typed, and does what the answer says.
 */

import type { Row, RowIcon } from "./row-model.ts";
import type { Section } from "./rows.ts";
import type { Hint, Verb } from "./verbs.ts";

/** What the launcher does once a scope's verb ran. */
export interface ScopeResult {
  /** The launcher closes (the paste goes to the window under it). */
  close?: true;
  /** A word at the field's right end ("Pinned"). */
  notice?: { text: string; ok: boolean };
  /** What the field holds next ("" once a snippet was added). */
  query?: string;
}

export interface LauncherScope {
  id: string;
  /** The action that opens it (`dashi://clipboard/history`). */
  address: string;
  chip: { title: string; icon?: RowIcon };
  placeholder: string;
  subscribe(listener: () => void): () => void;
  getSnapshot(): unknown;
  /** The rows for what is typed. A section with `window` draws that many rows at once, scrolled with the selection. */
  sections(query: string): Section[];
  /** A row's verbs, the first being what ↩ does. */
  verbs(row: Row, query: string): Verb[];
  /** The field's right end for the selected row. */
  hints(row: Row | undefined): Hint[];
  run(verb: string, row: Row | undefined, query: string): ScopeResult | Promise<ScopeResult>;
}
