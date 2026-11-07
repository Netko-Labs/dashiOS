/**
 * The window's document: its file, the text as typed and as last written
 * (they differ only for a moment while it is edited), the encoding and line
 * endings it is written back with, Undo, Find, and the View settings. A
 * store with the usual subscribe/getSnapshot pair; the window (view.tsx)
 * asks, this does.
 *
 * A document with a file saves on its own: `autosave` writes it (main.tsx
 * calls it a moment after typing stops and as the window closes), so a
 * close never asks. Each write first checks the file is as it was read or
 * last written (`Stamp`); when another program changed it, nothing is
 * written over it and `conflict` says so until the person picks a side.
 * Earlier versions of the file are kept (versions.ts) for Revert To…. An
 * Untitled document has no file: it is kept as a draft (recovery.ts).
 */

import { type Encoding, encodeText, type LineEnding } from "./codec.ts";
import { readDocument, type Stamp, sameStamp, stampOf, writeDocument } from "./files.ts";
import { findMatches, matchAtOrAfter, replaceAll, stepMatch } from "./find.ts";
import { History } from "./history.ts";
import { displayName } from "./names.ts";
import { DEFAULT_PREFS, type EditorPrefs, readPrefs, samePrefs, stepFontSize, writePrefs } from "./prefs.ts";
import type { Recovery } from "./recovery.ts";
import { AUTO_EVERY, type Version, type VersionStore } from "./versions.ts";

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

/** The file changed on disk while there were changes here (`changed`), or it isn't there any more (`gone`). */
export type Conflict = "changed" | "gone";

export interface EditorState {
  path: string | null;
  text: string;
  /** The text as it is in the file (as opened or last written). */
  saved: string;
  encoding: Encoding;
  lineEnding: LineEnding;
  /** Bumped when another document comes into the window: the input starts over. */
  session: number;
  notice: Notice | null;
  conflict: Conflict | null;
  canUndo: boolean;
  canRedo: boolean;
  /** What Edit's Undo and Redo name ("Typing", "Replace All"), null when nothing. */
  undoName: string | null;
  redoName: string | null;
  prefs: EditorPrefs;
  find: FindState;
  /** The offset Find wants scrolled into view; `seq` changes with each jump. */
  reveal: { offset: number; seq: number } | null;
}

export type SaveResult = "saved" | "needs-path" | "conflict" | "failed";
export type AutosaveResult = "saved" | "clean" | "draft" | "conflict" | "failed";

export interface ModelOptions {
  /** View settings: where they are read from and written to. */
  loadPrefs?: () => EditorPrefs;
  savePrefs?: (prefs: EditorPrefs) => void;
  /** Where earlier versions are kept (main.tsx gives the person's); none without it. */
  versions?: VersionStore | null;
  now?: () => number;
}

export const isDirty = (state: EditorState): boolean => state.text !== state.saved;

const NO_FIND: FindState = { query: "", caseSensitive: false, matches: [], current: -1 };

export class EditorModel {
  private readonly listeners = new Set<() => void>();
  private readonly history = new History();
  private readonly loadPrefs: () => EditorPrefs;
  private readonly savePrefs: (prefs: EditorPrefs) => void;
  private readonly versions: VersionStore | null;
  private readonly now: () => number;
  /** The file as it was read or last written; null without a file. */
  private stamp: Stamp | null = null;
  /** Whether the file as it was opened is kept as a version already (it is, once anything is written over it). */
  private versioned = false;
  /**
   * Kept changes that came back (`recover`) wait for the person before they
   * are written over the file: it may have changed since they were kept.
   */
  private held = false;
  private state: EditorState;

  constructor(options: ModelOptions = {}) {
    this.loadPrefs = options.loadPrefs ?? readPrefs;
    this.savePrefs = options.savePrefs ?? writePrefs;
    this.versions = options.versions ?? null;
    this.now = options.now ?? Date.now;
    this.state = {
      path: null,
      text: "",
      saved: "",
      encoding: "utf-8",
      lineEnding: "lf",
      session: 0,
      notice: null,
      conflict: null,
      canUndo: false,
      canRedo: false,
      undoName: null,
      redoName: null,
      prefs: this.loadPrefs(),
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
    this.stamp = read.stamp;
    this.versioned = false;
    this.held = false;
    const { text, encoding, lineEnding } = read.decoded;
    this.set({
      path,
      text,
      saved: text,
      encoding,
      lineEnding,
      session: this.state.session + 1,
      notice: null,
      conflict: null,
      ...this.findFor(text, { ...this.state.find, current: -1 }),
      reveal: null,
    });
    return true;
  }

  /**
   * Brings back what a window kept (recovery.ts): an Untitled draft as it
   * was, or changes that couldn't be written to a file, edited against the
   * file as it is now.
   */
  recover(recovery: Recovery): void {
    const onDisk = recovery.path !== null ? readDocument(recovery.path) : null;
    this.history.clear();
    this.stamp = onDisk?.ok ? onDisk.stamp : null;
    this.versioned = false;
    this.held = recovery.path !== null;
    const notice: Notice | null =
      recovery.path === null
        ? null
        : { text: `Changes that couldn't be saved to “${displayName(recovery.path)}” are back. They are saved once you edit again.`, tone: "info" };
    this.set({
      path: recovery.path,
      text: recovery.text,
      saved: onDisk?.ok ? onDisk.decoded.text : "",
      encoding: recovery.encoding,
      lineEnding: recovery.lineEnding,
      session: this.state.session + 1,
      notice,
      conflict: null,
      ...this.findFor(recovery.text, this.state.find),
    });
  }

  /** What to keep if the window goes now (recovery.ts); null when everything is written. */
  recovery(): Recovery | null {
    const { path, text, encoding, lineEnding } = this.state;
    return this.isDirty ? { path, text, encoding, lineEnding, time: this.now() } : null;
  }

  /** The input reported new text. `joinable` false keeps it its own Undo step, named `name`. */
  edit(text: string, joinable = true, name?: string): void {
    if (text === this.state.text) return;
    this.history.record(this.state.text, text, this.now(), joinable, name);
    this.held = false;
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

  /**
   * Writes the changes to the document's file, if it has one and nobody
   * else changed the file meanwhile. "draft" for Untitled (kept as a draft
   * instead), "clean" when there was nothing to write.
   */
  autosave(): AutosaveResult {
    const { path, conflict } = this.state;
    if (!this.isDirty) return "clean";
    if (path === null || this.held) return "draft";
    if (conflict || !this.checkStamp(path)) return "conflict";
    return this.writeTo(path, "auto") ? "saved" : "failed";
  }

  /** ❖S: writes the document now and keeps this as a version; "needs-path" for Untitled (the window asks where). */
  save(): SaveResult {
    const { path, conflict } = this.state;
    if (path === null) return "needs-path";
    if (conflict || !this.checkStamp(path)) return "conflict";
    return this.writeTo(path, "save") ? "saved" : "failed";
  }

  /** Writes the document to `path`, which becomes its file. */
  saveAs(path: string): boolean {
    return this.writeTo(path, "save-as");
  }

  /** The conflict's "Keep Mine": the text here is written over the file as it is on disk (or where it was). */
  keepMine(): boolean {
    const { path } = this.state;
    if (path === null) return false;
    this.stamp = stampOf(path);
    this.set({ conflict: null });
    return this.writeTo(path, "save");
  }

  /**
   * Looks at the file on disk (main.tsx asks every few seconds): a change
   * made elsewhere comes in quietly while there is nothing unsaved here (Undo
   * brings back what was here), and is a conflict while there is.
   */
  checkDisk(): void {
    const { path, conflict } = this.state;
    if (path === null || conflict) return;
    const now = stampOf(path);
    if (sameStamp(now, this.stamp)) return;
    if (now === null) {
      if (this.isDirty) this.set({ conflict: "gone" });
      return;
    }
    if (this.isDirty) this.set({ conflict: "changed" });
    else if (this.revert("Changes on Disk"))
      this.set({ notice: { text: `“${displayName(path)}” was changed by another app. Undo brings back what was here.`, tone: "info" } });
  }

  /**
   * Goes back to the file as it is on disk, as one Undo step: Undo brings the
   * changes back. False (and a notice) when the file can't be read.
   */
  revert(name = "Revert"): boolean {
    const { path } = this.state;
    if (path === null) return false;
    const read = readDocument(path);
    if (!read.ok) {
      this.set({ notice: { text: `“${displayName(path)}” couldn't be read. ${read.message}`, tone: "error" } });
      return false;
    }
    this.stamp = read.stamp;
    const { text, encoding, lineEnding } = read.decoded;
    this.set({ saved: text, encoding, lineEnding, conflict: null });
    this.edit(text, false, name);
    return true;
  }

  /** The file's earlier versions, newest first (none for Untitled). */
  listVersions(): Version[] {
    const { path } = this.state;
    return path !== null && this.versions ? this.versions.list(path) : [];
  }

  /** A version's text, or null when it is gone. */
  versionText(version: Version): string | null {
    const { path } = this.state;
    return path !== null && this.versions ? this.versions.read(path, version) : null;
  }

  /** Revert To: `version`'s text, as one Undo step; the text it replaces is kept as a version first. */
  revertTo(version: Version): boolean {
    const { path, text } = this.state;
    const earlier = this.versionText(version);
    if (path === null || earlier === null) return false;
    this.versions?.add(path, text, "auto", this.now(), this.now());
    this.edit(earlier, false, "Revert");
    return true;
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
    this.set({ find: { ...find, current } });
    this.reveal(find.matches[current] as number);
    return true;
  }

  /** Asks the window to scroll `offset` into view. */
  reveal(offset: number): void {
    this.set({ reveal: { offset, seq: (this.state.reveal?.seq ?? 0) + 1 } });
  }

  /** Replaces every match (one Undo step); how many there were. */
  replaceAll(replacement: string): number {
    const { query, caseSensitive } = this.state.find;
    const result = replaceAll(this.state.text, query, replacement, { caseSensitive });
    if (result.count > 0) {
      this.edit(result.text, false, "Replace All");
      this.set({ notice: { text: `Replaced ${result.count} ${result.count === 1 ? "match" : "matches"}.`, tone: "info" } });
    }
    return result.count;
  }

  setMonospace(monospace: boolean): void {
    this.setPrefs({ ...this.state.prefs, monospace });
  }

  setLineNumbers(lineNumbers: boolean): void {
    this.setPrefs({ ...this.state.prefs, lineNumbers });
  }

  /** Bigger (1), Smaller (-1), or the default size (0). */
  stepFontSize(step: 1 | -1 | 0): void {
    const fontSize = step === 0 ? DEFAULT_PREFS.fontSize : stepFontSize(this.state.prefs.fontSize, step);
    this.setPrefs({ ...this.state.prefs, fontSize });
  }

  /** Another window changed the View settings: this one follows, writing nothing. */
  reloadPrefs(): void {
    const prefs = this.loadPrefs();
    if (!samePrefs(prefs, this.state.prefs)) this.set({ prefs });
  }

  private setPrefs(prefs: EditorPrefs): void {
    if (samePrefs(prefs, this.state.prefs)) return;
    this.set({ prefs });
    this.savePrefs(prefs);
  }

  /** Whether the file is as it was read or last written; when it isn't, the conflict says how. */
  private checkStamp(path: string): boolean {
    const now = stampOf(path);
    if (sameStamp(now, this.stamp)) return true;
    this.set({ conflict: now === null ? "gone" : "changed" });
    return false;
  }

  /** Keeps what the file holds as a version before it is first written over, and every `AUTO_EVERY` after. */
  private keepVersion(path: string, reason: "auto" | "save" | "save-as"): void {
    const { versions } = this;
    if (!versions || reason === "save-as" || path !== this.state.path) return;
    const time = this.stamp?.mtimeMs ?? this.now();
    if (!this.versioned) versions.add(path, this.state.saved, "opened", time, this.now());
    else if (this.now() - (versions.newest(path) ?? 0) >= AUTO_EVERY) versions.add(path, this.state.saved, "auto", time, this.now());
    this.versioned = true;
  }

  private writeTo(path: string, reason: "auto" | "save" | "save-as"): boolean {
    const name = displayName(path);
    let { encoding } = this.state;
    let bytes = encodeText(this.state.text, encoding, this.state.lineEnding);
    let notice: Notice | null = null;
    if (!bytes) {
      encoding = "utf-8";
      bytes = encodeText(this.state.text, encoding, this.state.lineEnding) as Uint8Array;
      notice = { text: `“${name}” was saved as UTF-8: its encoding can't hold some of the characters.`, tone: "info" };
    }
    this.keepVersion(path, reason);
    const problem = writeDocument(path, bytes);
    if (problem !== null) {
      const kept = reason === "auto" ? " Your changes are kept here; Save As puts them somewhere else." : "";
      this.set({ notice: { text: `“${name}” couldn't be saved. ${problem}${kept}`, tone: "error" } });
      return false;
    }
    this.stamp = stampOf(path);
    if (reason === "save") this.versions?.add(path, this.state.text, "saved", this.now(), this.now());
    if (reason !== "auto") this.versioned = true;
    // An autosave says nothing; a notice it would replace stays.
    this.set({ path, saved: this.state.text, encoding, conflict: null, notice: notice ?? (reason === "auto" ? this.state.notice : null) });
    return true;
  }

  private replaceText(text: string): void {
    const find = this.state.find;
    // The match shown stays the one at (or after) where it was.
    const at = find.current >= 0 ? (find.matches[find.current] ?? 0) : -1;
    const next = this.findFor(text, find);
    const current = at >= 0 ? matchAtOrAfter(next.find.matches, at) : -1;
    this.set({ text, notice: null, ...this.undoNames(), find: { ...next.find, current } });
  }

  /** The Undo state (which changes with every new text). */
  private undoNames(): Pick<EditorState, "canUndo" | "canRedo" | "undoName" | "redoName"> {
    const { canUndo, canRedo, undoName, redoName } = this.history;
    return { canUndo, canRedo, undoName, redoName };
  }

  /** `find` with its matches in `text`, and the Undo state. */
  private findFor(text: string, find: FindState): Pick<EditorState, "find" | "canUndo" | "canRedo" | "undoName" | "redoName"> {
    const matches = findMatches(text, find.query, { caseSensitive: find.caseSensitive });
    return { find: { ...find, matches, current: Math.min(find.current, matches.length - 1) }, ...this.undoNames() };
  }

  private set(change: Partial<EditorState>): void {
    this.state = { ...this.state, ...change };
    for (const listener of this.listeners) listener();
  }
}
