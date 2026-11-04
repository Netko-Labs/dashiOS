/**
 * The notes on disk: plain Markdown files under a root (`~/Documents/Notes`),
 * one folder level, `<root>/<Folder>/<title>.md`, notes directly in the root
 * being the default folder. Pinned notes and Recently Deleted's bookkeeping
 * are in the JSON sidecar (sidecar.ts). Everything here is synchronous, takes
 * the root as a plain argument (tests give it a temp dir), and never touches
 * a path outside it: ids are checked (`names.inside`), symlinks are skipped,
 * writes are atomic, and moves never overwrite.
 */

import { type Dirent, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, statSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isRealDirectory, isRegularFile, MAX_NOTE_BYTES, moveNoClobber, writeAtomic, writeNew } from "./files.ts";
import { DEFAULT_FOLDER_NAME, inside, isNoteId, noteId, sanitizeName, splitId, uniqueName } from "./names.ts";
import { readSidecar, type Sidecar, writeSidecar } from "./sidecar.ts";
import { parseNote, serializeNote } from "./text.ts";
import { type DeletedNote, type Note, NotesError, type Snapshot } from "./types.ts";

export const TRASH_DIR = ".Recently Deleted";
/** How long a deleted note stays in Recently Deleted. */
export const KEEP_DAYS = 30;
const DAY_MS = 86_400_000;

/** `~/Documents/Notes`, or `$DASHI_NOTES_DIR`. */
export function defaultRoot(env: Record<string, string | undefined> = process.env): string {
  return env.DASHI_NOTES_DIR || join(env.HOME || homedir(), "Documents", "Notes");
}

const isNoteFile = (entry: Dirent): boolean => entry.isFile() && !entry.name.startsWith(".") && /\.md$/i.test(entry.name);

export class NotesStore {
  /** Parsed files by path, valid while their size and mtime hold. */
  private readonly cache = new Map<string, { mtimeMs: number; size: number; text: ReturnType<typeof parseNote> }>();

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
    return { notes, folders, deleted: this.deleted(sidecar) };
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
    const folder = this.ensureFolder(options.folder ?? "");
    const title = (options.title ?? "").replace(/\s+/g, " ").trim();
    const text = serializeNote({ title, body: options.body ?? "", heading: true });
    const dir = this.dir(folder);
    for (;;) {
      const file = `${uniqueName(sanitizeName(title), this.names(dir), ".md")}.md`;
      try {
        writeNew(join(dir, file), text);
      } catch (error) {
        // Someone took the name between looking and writing: look again.
        if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
        throw error;
      }
      return this.read(noteId(folder, file));
    }
  }

  /** Saves the title and body (the file is renamed to follow the title); returns the note as it is now, with its new id. */
  save(id: string, change: { title: string; body: string }): Note {
    const { folder, file } = this.locate(id);
    const path = join(this.dir(folder), file);
    const current = parseNote(readFileSync(path, "utf8"));
    // A file from elsewhere keeps the way it writes its first line; a new, empty note starts with "# ".
    const heading = current.heading || (current.title === "" && current.body.trim() === "");
    writeAtomic(path, serializeNote({ title: change.title, body: change.body, heading }));
    return this.read(this.follow(folder, file, change.title));
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
    this.cache.delete(path);
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
    const target = this.ensureFolder(folder);
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
    const folder = this.ensureFolder(from.folder);
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
    const files = this.deleted(readSidecar(this.root)).map((note) => note.id);
    for (const file of files) this.purge(file);
    return files.length;
  }

  /** Removes what has been deleted for more than `KEEP_DAYS`; returns how many went. */
  purgeExpired(): number {
    const cutoff = this.now() - KEEP_DAYS * DAY_MS;
    const old = this.deleted(readSidecar(this.root)).filter((note) => note.deletedAt < cutoff);
    for (const note of old) this.purge(note.id);
    return old.length;
  }

  // Folders

  /** Makes a folder; returns the name it got (sanitized, made unique). */
  createFolder(name: string): string {
    const clean = uniqueName(sanitizeName(name, "New Folder"), this.folderNames(), "");
    mkdirSync(join(this.root, clean));
    return clean;
  }

  renameFolder(from: string, name: string): string {
    this.requireFolder(from);
    const others = this.folderNames().filter((each) => each.toLowerCase() !== from.toLowerCase());
    const clean = uniqueName(sanitizeName(name, "New Folder"), others, "");
    if (clean === from) return from;
    renameSync(join(this.root, from), join(this.root, clean));
    const rewrite = (id: string): string => (id.startsWith(`${from}/`) ? `${clean}/${id.slice(from.length + 1)}` : id);
    this.update((sidecar) => {
      sidecar.pinned = sidecar.pinned.map(rewrite);
      for (const entry of Object.values(sidecar.trash)) entry.from = rewrite(entry.from);
    });
    return clean;
  }

  /** Deletes a folder: its notes go to Recently Deleted; the folder goes if nothing else is in it. */
  deleteFolder(name: string): number {
    this.requireFolder(name);
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

  /** Names a new folder must not take: the folders there are, and the default folder's own name. */
  private folderNames(): string[] {
    const here = readdirSync(this.root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    return [...here, DEFAULT_FOLDER_NAME, TRASH_DIR];
  }

  private requireFolder(name: string): void {
    if (name === "" || name.startsWith(".") || name.includes("/") || !isRealDirectory(join(this.root, name)))
      throw new NotesError(`There is no folder ${JSON.stringify(name)}.`);
  }

  /** The folder to write into: "" or an existing folder, or one made from `folder`'s sanitized name. */
  private ensureFolder(folder: string): string {
    if (folder === "") return "";
    const clean = sanitizeName(folder, "New Folder");
    if (clean.toLowerCase() === DEFAULT_FOLDER_NAME.toLowerCase()) return "";
    const existing = readdirSync(this.root, { withFileTypes: true }).find((entry) => entry.isDirectory() && entry.name.toLowerCase() === clean.toLowerCase());
    if (existing) return existing.name;
    mkdirSync(join(this.root, clean));
    return clean;
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
    this.cache.delete(join(dir, file));
    return now;
  }

  private load(folder: string, file: string, pinned: ReadonlySet<string>): Note | null {
    const path = join(this.dir(folder), file);
    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(path);
    } catch {
      return null;
    }
    if (!isRegularFile(path) || stat.size > MAX_NOTE_BYTES) return null;
    let cached = this.cache.get(path);
    if (!cached || cached.mtimeMs !== stat.mtimeMs || cached.size !== stat.size) {
      try {
        cached = { mtimeMs: stat.mtimeMs, size: stat.size, text: parseNote(readFileSync(path, "utf8")) };
      } catch {
        return null;
      }
      this.cache.set(path, cached);
    }
    const id = noteId(folder, file);
    const { title, body, heading } = cached.text;
    return {
      id,
      folder,
      title,
      body,
      heading,
      modified: stat.mtimeMs,
      created: stat.birthtimeMs > 0 ? stat.birthtimeMs : stat.mtimeMs,
      pinned: pinned.has(id),
    };
  }

  private collect(into: Note[], folder: string, file: string, pinned: ReadonlySet<string>): void {
    const note = this.load(folder, file, pinned);
    if (note) into.push(note);
  }

  private deleted(sidecar: Sidecar): DeletedNote[] {
    const dir = join(this.root, TRASH_DIR);
    if (!existsSync(dir)) return [];
    const out: DeletedNote[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!isNoteFile(entry)) continue;
      try {
        const path = join(dir, entry.name);
        const stat = statSync(path);
        if (stat.size > MAX_NOTE_BYTES) continue;
        const meta = sidecar.trash[entry.name];
        out.push({
          id: entry.name,
          ...parseNote(readFileSync(path, "utf8")),
          modified: stat.mtimeMs,
          from: meta?.from ?? entry.name,
          deletedAt: meta?.at ?? stat.ctimeMs,
        });
      } catch {
        // Gone while reading.
      }
    }
    return out.sort((a, b) => b.deletedAt - a.deletedAt);
  }

  private update(change: (sidecar: Sidecar) => void): void {
    const sidecar = readSidecar(this.root);
    change(sidecar);
    writeSidecar(this.root, sidecar);
  }
}
