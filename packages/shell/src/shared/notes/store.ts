/**
 * The notes on disk: plain Markdown files under a root (`~/Documents/Notes`),
 * one folder level, `<root>/<Folder>/<title>.md`, notes directly in the root
 * being the default folder. Pinned notes and Recently Deleted's bookkeeping
 * are in the JSON sidecar (sidecar.ts). Everything here is synchronous, takes
 * the root as a plain argument (tests give it a temp dir), and never touches
 * a path outside it: ids are checked (`names.inside`), symlinks are skipped,
 * writes are atomic, and moves never overwrite.
 */

import { mkdirSync, readdirSync, readFileSync, rmdirSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isErrno } from "../files/errno.ts";
import { isRegularFile, moveNoClobber, writeAtomic, writeNew } from "../fs/atomic.ts";
import { createFolder, ensureFolder, renameFolder, requireFolder } from "./folders.ts";
import { inside, isNoteId, noteId, sanitizeName, splitId, uniqueName } from "./names.ts";
import { isNoteFile, NoteCache } from "./read-note.ts";
import { listDeleted, TRASH_DIR } from "./recently-deleted.ts";
import { readSidecar, type Sidecar, updateSidecar } from "./sidecar.ts";
import { parseNote, serializeNote } from "./text.ts";
import { type Note, NotesError, type Snapshot } from "./types.ts";

export { TRASH_DIR } from "./recently-deleted.ts";
/** How long a deleted note stays in Recently Deleted. */
export const KEEP_DAYS = 30;
const DAY_MS = 86_400_000;

/** `~/Documents/Notes`, or `$DASHI_NOTES_DIR`. */
export function defaultRoot(env: Record<string, string | undefined> = process.env): string {
  return env.DASHI_NOTES_DIR || join(env.HOME || homedir(), "Documents", "Notes");
}

export class NotesStore {
  private readonly cache = new NoteCache();

  constructor(
    readonly root: string,
    private readonly now: () => number = Date.now,
  ) {
    mkdirSync(root, { recursive: true });
  }

  // Reading

  scan(): Snapshot {
    const sidecar = readSidecar(this.root);
    const pinned = new Set(sidecar.pinned);
    const notes: Note[] = [];
    const folders: string[] = [];
    for (const entry of readdirSync(this.root, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      if (entry.isDirectory()) {
        folders.push(entry.name);
        for (const file of readdirSync(join(this.root, entry.name), { withFileTypes: true })) {
          if (isNoteFile(file)) this.collect(notes, entry.name, file.name, pinned);
        }
      } else if (isNoteFile(entry)) {
        this.collect(notes, "", entry.name, pinned);
      }
    }
    folders.sort((a, b) => a.localeCompare(b));
    return { notes, folders, deleted: listDeleted(this.root, sidecar) };
  }

  /** One note, read fresh. */
  read(id: string): Note {
    const { folder, file } = this.locate(id);
    const note = this.load(folder, file, new Set(readSidecar(this.root).pinned));
    if (!note) throw new NotesError(`There is no note ${id}.`);
    return note;
  }

  // Notes

  /** A new note; with no title it is "Untitled" until one is typed. */
  create(options: { folder?: string; title?: string; body?: string } = {}): Note {
    const folder = ensureFolder(this.root, options.folder ?? "");
    const title = (options.title ?? "").replace(/\s+/g, " ").trim();
    const text = serializeNote({ title, body: options.body ?? "", heading: true });
    const dir = this.dir(folder);
    for (;;) {
      const file = `${uniqueName(sanitizeName(title), this.names(dir), ".md")}.md`;
      try {
        writeNew(join(dir, file), text);
      } catch (error) {
        // Someone took the name between looking and writing: look again.
        if (isErrno(error) && error.code === "EEXIST") continue;
        throw error;
      }
      return this.read(noteId(folder, file));
    }
  }

  /** Saves the title and body (the file is renamed to follow the title, unless `rename` is false); returns the note as it is now, with its id. */
  save(id: string, change: { title: string; body: string }, options: { rename?: boolean } = {}): Note {
    const { folder, file } = this.locate(id);
    const path = join(this.dir(folder), file);
    const current = parseNote(readFileSync(path, "utf8"));
    // A file from elsewhere keeps the way it writes its first line; a new, empty note starts with "# ".
    const heading = current.heading || (current.title === "" && current.body.trim() === "");
    writeAtomic(path, serializeNote({ title: change.title, body: change.body, heading }));
    // The window saves as it is typed in without renaming (sync tools would see a delete and a create at every pause), and names the file once the note is left (`settleName`).
    return this.read(options.rename === false ? id : this.follow(folder, file, change.title));
  }

  /** Renames a note's file to follow its title, if it doesn't yet; returns the id it has now. */
  settleName(id: string): string {
    const { folder, file } = this.locate(id);
    return this.follow(folder, file, this.read(id).title);
  }

  /** Adds `text` on a new line at the end of the note. */
  append(id: string, text: string): Note {
    const note = this.read(id);
    const body = note.body.trim() === "" ? text : `${note.body.replace(/\s+$/, "")}\n${text}`;
    return this.save(id, { title: note.title, body });
  }

  /** Removes a note that has nothing in it (a new note left untouched); false, and nothing removed, if it holds anything. */
  discardIfEmpty(id: string): boolean {
    const { folder, file } = this.locate(id);
    const path = join(this.dir(folder), file);
    if (readFileSync(path, "utf8").trim() !== "") return false;
    unlinkSync(path);
    this.cache.forget(path);
    this.update((sidecar) => {
      sidecar.pinned = sidecar.pinned.filter((each) => each !== id);
    });
    return true;
  }

  setPinned(id: string, pinned: boolean): void {
    this.locate(id);
    this.update((sidecar) => {
      sidecar.pinned = pinned ? [...new Set([...sidecar.pinned, id])] : sidecar.pinned.filter((each) => each !== id);
    });
  }

  /** Moves a note to `folder` ("" is the default one); returns its new id. */
  move(id: string, folder: string): string {
    const from = this.locate(id);
    const target = ensureFolder(this.root, folder);
    if (target === from.folder) return id;
    const name = `${uniqueName(from.file.replace(/\.md$/i, ""), this.names(this.dir(target)), ".md")}.md`;
    moveNoClobber(join(this.dir(from.folder), from.file), join(this.dir(target), name));
    const next = noteId(target, name);
    this.update((sidecar) => {
      sidecar.pinned = sidecar.pinned.map((each) => (each === id ? next : each));
    });
    return next;
  }

  // Recently Deleted

  /** Moves a note to Recently Deleted; returns its name there. */
  trash(id: string): string {
    const { folder, file } = this.locate(id);
    mkdirSync(join(this.root, TRASH_DIR), { recursive: true });
    const name = `${uniqueName(file.replace(/\.md$/i, ""), this.names(join(this.root, TRASH_DIR)), ".md")}.md`;
    moveNoClobber(join(this.dir(folder), file), join(this.root, TRASH_DIR, name));
    this.update((sidecar) => {
      sidecar.pinned = sidecar.pinned.filter((each) => each !== id);
      sidecar.trash[name] = { from: id, at: this.now() };
    });
    return name;
  }

  /** Puts a deleted note back where it was (its folder is made again if it's gone); returns its id. */
  restore(file: string): string {
    const entry = readSidecar(this.root).trash[file];
    const source = this.trashPath(file);
    const from = entry && isNoteId(entry.from) ? splitId(entry.from) : { folder: "", file };
    const folder = ensureFolder(this.root, from.folder);
    const name = `${uniqueName(from.file.replace(/\.md$/i, ""), this.names(this.dir(folder)), ".md")}.md`;
    moveNoClobber(source, join(this.dir(folder), name));
    this.update((sidecar) => {
      delete sidecar.trash[file];
    });
    return noteId(folder, name);
  }

  /** Removes a deleted note for good. */
  purge(file: string): void {
    unlinkSync(this.trashPath(file));
    this.update((sidecar) => {
      delete sidecar.trash[file];
    });
  }

  emptyTrash(): number {
    const files = listDeleted(this.root, readSidecar(this.root)).map((note) => note.id);
    for (const file of files) this.purge(file);
    return files.length;
  }

  /** Removes what has been deleted for more than `KEEP_DAYS`; returns how many went. */
  purgeExpired(): number {
    const cutoff = this.now() - KEEP_DAYS * DAY_MS;
    const old = listDeleted(this.root, readSidecar(this.root)).filter((note) => note.deletedAt < cutoff);
    for (const note of old) this.purge(note.id);
    return old.length;
  }

  // Folders

  /** Makes a folder; returns the name it got (sanitized, made unique). */
  createFolder(name: string): string {
    return createFolder(this.root, name);
  }

  renameFolder(from: string, name: string): string {
    return renameFolder(this.root, from, name);
  }

  /** Deletes a folder: its notes go to Recently Deleted; the folder goes if nothing else is in it. */
  deleteFolder(name: string): number {
    requireFolder(this.root, name);
    const dir = this.dir(name);
    const files = readdirSync(dir, { withFileTypes: true }).filter(isNoteFile);
    for (const file of files) this.trash(noteId(name, file.name));
    try {
      rmdirSync(dir);
    } catch {
      // Other files are in it: they are not ours to remove.
    }
    return files.length;
  }

  // Internals

  /** The folder and file of an id, checked: inside the root, a real file. */
  private locate(id: string): { folder: string; file: string } {
    if (!isNoteId(id) || inside(this.root, id) === null) throw new NotesError(`${JSON.stringify(id)} is not a note id.`);
    const place = splitId(id);
    if (!isRegularFile(join(this.dir(place.folder), place.file))) throw new NotesError(`There is no note ${id}.`);
    return place;
  }

  private dir(folder: string): string {
    return folder === "" ? this.root : join(this.root, folder);
  }

  private trashPath(file: string): string {
    if (file.includes("/") || file.includes("\u0000") || file.startsWith(".") || !/\.md$/i.test(file))
      throw new NotesError(`${JSON.stringify(file)} is not in Recently Deleted.`);
    const path = join(this.root, TRASH_DIR, file);
    if (!isRegularFile(path)) throw new NotesError(`${file} is not in Recently Deleted.`);
    return path;
  }

  private names(dir: string): string[] {
    try {
      return readdirSync(dir);
    } catch {
      return [];
    }
  }

  /** Renames `file` to follow `title` if its name should change; returns the id it has now. */
  private follow(folder: string, file: string, title: string): string {
    const dir = this.dir(folder);
    const others = this.names(dir).filter((name) => name !== file);
    const wanted = `${uniqueName(sanitizeName(title), others, ".md")}.md`;
    const was = noteId(folder, file);
    if (wanted === file) return was;
    moveNoClobber(join(dir, file), join(dir, wanted));
    const now = noteId(folder, wanted);
    this.update((sidecar) => {
      sidecar.pinned = sidecar.pinned.map((each) => (each === was ? now : each));
    });
    this.cache.forget(join(dir, file));
    return now;
  }

  private load(folder: string, file: string, pinned: ReadonlySet<string>): Note | null {
    return this.cache.load(join(this.dir(folder), file), folder, file, pinned);
  }

  private collect(into: Note[], folder: string, file: string, pinned: ReadonlySet<string>): void {
    const note = this.load(folder, file, pinned);
    if (note) into.push(note);
  }

  private update(change: (sidecar: Sidecar) => void): void {
    updateSidecar(this.root, change);
  }
}
