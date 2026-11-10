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

import { encodeText } from "./codec.ts";
import { EditorDocument } from "./document.ts";
import { readDocument, type Stamp, sameStamp, stampOf, writeDocument } from "./files.ts";
import { displayName } from "./names.ts";
import { readPrefs, writePrefs } from "./prefs.ts";
import type { Recovery } from "./recovery.ts";
import { type AutosaveResult, isDirty, type ModelOptions, NO_FIND, type Notice, type SaveResult } from "./state.ts";
import { AUTO_EVERY, type Version, type VersionStore } from "./versions.ts";

// The state and the names the window and the other files use, from state.ts.
export { type AutosaveResult, type Conflict, type EditorState, type FindState, isDirty, type ModelOptions, type Notice, type SaveResult } from "./state.ts";

export class EditorModel extends EditorDocument {
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

  constructor(options: ModelOptions = {}) {
    const loadPrefs = options.loadPrefs ?? readPrefs;
    super(
      {
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
        prefs: loadPrefs(),
        find: NO_FIND,
        reveal: null,
      },
      loadPrefs,
      options.savePrefs ?? writePrefs,
    );
    this.versions = options.versions ?? null;
    this.now = options.now ?? Date.now;
  }

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
}
