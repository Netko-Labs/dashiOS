/**
 * The window's document: its file, the text as typed and as last saved
 * (they differ while it is edited), the encoding and line endings it is
 * written back with, Undo, Find, and the View settings. A store with the
 * usual subscribe/getSnapshot pair; the window (view.tsx) asks, this does.
 */

import { type Encoding, encodeText, type LineEnding } from "./codec.ts";
import { readDocument, writeDocument } from "./files.ts";
import { findMatches, matchAtOrAfter, replaceAll, stepMatch } from "./find.ts";
import { History } from "./history.ts";
import { displayName } from "./names.ts";
import { DEFAULT_PREFS, type EditorPrefs, readPrefs, stepFontSize, writePrefs } from "./prefs.ts";
import type { Recovery } from "./recovery.ts";

export interface Notice {
  text: string;
  tone: "info" | "error";
}

export interface FindState {
  query: string;
  caseSensitive: boolean;
  /** Where each match starts. */
  matches: readonly number[];
  /** The match shown, -1 before one is. */
  current: number;
}

export interface EditorState {
  path: string | null;
  text: string;
  /** The text as it is in the file (as opened or last saved). */
  saved: string;
  encoding: Encoding;
  lineEnding: LineEnding;
  /** Bumped when another document comes into the window: the input starts over. */
  session: number;
  notice: Notice | null;
  canUndo: boolean;
  canRedo: boolean;
  prefs: EditorPrefs;
  find: FindState;
  /** The offset Find wants scrolled into view; `seq` changes with each jump. */
  reveal: { offset: number; seq: number } | null;
}

export type SaveResult = "saved" | "needs-path" | "failed";

export interface ModelOptions {
  /** View settings: where they are read from and written to. */
  loadPrefs?: () => EditorPrefs;
  savePrefs?: (prefs: EditorPrefs) => void;
  now?: () => number;
}

export const isDirty = (state: EditorState): boolean => state.text !== state.saved;

const NO_FIND: FindState = { query: "", caseSensitive: false, matches: [], current: -1 };

export class EditorModel {
  private readonly listeners = new Set<() => void>();
  private readonly history = new History();
  private readonly savePrefs: (prefs: EditorPrefs) => void;
  private readonly now: () => number;
  private state: EditorState;

  constructor(options: ModelOptions = {}) {
    this.savePrefs = options.savePrefs ?? writePrefs;
    this.now = options.now ?? Date.now;
    this.state = {
      path: null,
      text: "",
      saved: "",
      encoding: "utf-8",
      lineEnding: "lf",
      session: 0,
      notice: null,
      canUndo: false,
      canRedo: false,
      prefs: (options.loadPrefs ?? readPrefs)(),
      find: NO_FIND,
      reveal: null,
    };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): EditorState => this.state;

  /** An Untitled document nobody has typed in: opening a file can take its place. */
  get isPristine(): boolean {
    return this.state.path === null && this.state.text === "" && this.state.saved === "";
  }

  get isDirty(): boolean {
    return isDirty(this.state);
  }

  /** Opens `path` in place of the document; false (and a notice) when it can't be. */
  open(path: string): boolean {
    const read = readDocument(path);
    if (!read.ok) {
      this.set({ notice: { text: `“${displayName(path)}” couldn't be opened. ${read.message}`, tone: "error" } });
      return false;
    }
    this.history.clear();
    const { text, encoding, lineEnding } = read.decoded;
    this.set({
      path,
      text,
      saved: text,
      encoding,
      lineEnding,
      session: this.state.session + 1,
      notice: null,
      ...this.findFor(text, { ...this.state.find, current: -1 }),
      reveal: null,
    });
    return true;
  }

  /** Brings back changes kept when a window closed (recovery.ts): edited, against the file as it is now. */
  recover(recovery: Recovery): void {
    const onDisk = recovery.path !== null ? readDocument(recovery.path) : null;
    this.history.clear();
    this.set({
      path: recovery.path,
      text: recovery.text,
      saved: onDisk?.ok ? onDisk.decoded.text : "",
      encoding: recovery.encoding,
      lineEnding: recovery.lineEnding,
      session: this.state.session + 1,
      notice: { text: "These changes weren't saved when the window closed.", tone: "info" },
      ...this.findFor(recovery.text, this.state.find),
    });
  }

  /** What to keep if the window goes now (recovery.ts); null when there is nothing unsaved. */
  recovery(): Recovery | null {
    const { path, text, encoding, lineEnding } = this.state;
    return this.isDirty ? { path, text, encoding, lineEnding, time: this.now() } : null;
  }

  /** The input reported new text. `joinable` false keeps it its own Undo step. */
  edit(text: string, joinable = true): void {
    if (text === this.state.text) return;
    this.history.record(this.state.text, text, this.now(), joinable);
    this.replaceText(text);
  }

  undo(): void {
    const text = this.history.undo(this.state.text);
    if (text !== null) this.replaceText(text);
  }

  redo(): void {
    const text = this.history.redo(this.state.text);
    if (text !== null) this.replaceText(text);
  }

  /** Writes the document to its file; "needs-path" for Untitled (the window asks where). */
  save(): SaveResult {
    if (this.state.path === null) return "needs-path";
    return this.writeTo(this.state.path) ? "saved" : "failed";
  }

  /** Writes the document to `path`, which becomes its file. */
  saveAs(path: string): boolean {
    return this.writeTo(path);
  }

  /** Goes back to the file as it is on disk. */
  revert(): void {
    if (this.state.path !== null) this.open(this.state.path);
  }

  dismissNotice(): void {
    if (this.state.notice) this.set({ notice: null });
  }

  setQuery(query: string): void {
    this.set(this.findFor(this.state.text, { ...this.state.find, query, current: -1 }));
  }

  setCaseSensitive(caseSensitive: boolean): void {
    this.set(this.findFor(this.state.text, { ...this.state.find, caseSensitive, current: -1 }));
  }

  /** Shows the next (`step` 1) or previous match and asks the window to scroll to it; false when there is none. */
  findNext(step: 1 | -1): boolean {
    const { find } = this.state;
    const current = stepMatch(find.matches.length, find.current, step);
    if (current < 0) return false;
    const offset = find.matches[current] as number;
    this.set({ find: { ...find, current }, reveal: { offset, seq: (this.state.reveal?.seq ?? 0) + 1 } });
    return true;
  }

  /** Replaces every match (one Undo step); how many there were. */
  replaceAll(replacement: string): number {
    const { query, caseSensitive } = this.state.find;
    const result = replaceAll(this.state.text, query, replacement, { caseSensitive });
    if (result.count > 0) {
      this.edit(result.text, false);
      this.set({ notice: { text: `Replaced ${result.count} ${result.count === 1 ? "match" : "matches"}.`, tone: "info" } });
    }
    return result.count;
  }

  setMonospace(monospace: boolean): void {
    this.setPrefs({ ...this.state.prefs, monospace });
  }

  /** Bigger (1), Smaller (-1), or the default size (0). */
  stepFontSize(step: 1 | -1 | 0): void {
    const fontSize = step === 0 ? DEFAULT_PREFS.fontSize : stepFontSize(this.state.prefs.fontSize, step);
    this.setPrefs({ ...this.state.prefs, fontSize });
  }

  private setPrefs(prefs: EditorPrefs): void {
    if (prefs.monospace === this.state.prefs.monospace && prefs.fontSize === this.state.prefs.fontSize) return;
    this.set({ prefs });
    this.savePrefs(prefs);
  }

  private writeTo(path: string): boolean {
    const name = displayName(path);
    let { encoding } = this.state;
    let bytes = encodeText(this.state.text, encoding, this.state.lineEnding);
    let notice: Notice | null = null;
    if (!bytes) {
      encoding = "utf-8";
      bytes = encodeText(this.state.text, encoding, this.state.lineEnding) as Uint8Array;
      notice = { text: `“${name}” was saved as UTF-8: its encoding can't hold some of the characters.`, tone: "info" };
    }
    const problem = writeDocument(path, bytes);
    if (problem !== null) {
      this.set({ notice: { text: `“${name}” couldn't be saved. ${problem}`, tone: "error" } });
      return false;
    }
    this.set({ path, saved: this.state.text, encoding, notice });
    return true;
  }

  private replaceText(text: string): void {
    const find = this.state.find;
    // The match shown stays the one at (or after) where it was.
    const at = find.current >= 0 ? (find.matches[find.current] ?? 0) : -1;
    const next = this.findFor(text, find);
    const current = at >= 0 ? matchAtOrAfter(next.find.matches, at) : -1;
    this.set({ text, notice: null, canUndo: this.history.canUndo, canRedo: this.history.canRedo, find: { ...next.find, current } });
  }

  /** `find` with its matches in `text`, and the Undo state (which changes with every new text). */
  private findFor(text: string, find: FindState): Pick<EditorState, "find" | "canUndo" | "canRedo"> {
    const matches = findMatches(text, find.query, { caseSensitive: find.caseSensitive });
    return { find: { ...find, matches, current: Math.min(find.current, matches.length - 1) }, canUndo: this.history.canUndo, canRedo: this.history.canRedo };
  }

  private set(change: Partial<EditorState>): void {
    this.state = { ...this.state, ...change };
    for (const listener of this.listeners) listener();
  }
}
