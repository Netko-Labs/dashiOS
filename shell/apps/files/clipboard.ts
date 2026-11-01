/**
 * Files on the clipboard. Within Files, copy and cut are remembered in
 * memory. To reach other apps they are also put on the system clipboard as
 * `text/uri-list` (RFC 2483, CRLF lines of `file://` URIs) when wl-clipboard
 * is installed, and paste reads what other file managers left there:
 * `x-special/gnome-copied-files` (Nautilus: "copy" or "cut", then URIs) or
 * `text/uri-list`. Metal has no clipboard API yet (kit/clipboard.ts).
 */

import { type Exec, exec } from "./exec.ts";
import { normalizePath } from "./paths.ts";
import { fileUri, parseFileUri } from "./uri.ts";

export const URI_LIST = "text/uri-list";
export const GNOME_FILES = "x-special/gnome-copied-files";

/** The text/uri-list body for `paths`: one URI per CRLF-ended line. */
export function encodeUriList(paths: readonly string[]): string {
  return paths.map((path) => `${fileUri(path)}\r\n`).join("");
}

/** The local paths in a uri-list; comments (`#`), other schemes, remote hosts, and relative paths are dropped. */
export function parseUriList(text: string, limit = 5000): string[] {
  const paths: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const path = parseFileUri(line);
    const clean = path === null ? null : normalizePath(path);
    if (clean !== null && !paths.includes(clean)) paths.push(clean);
    if (paths.length >= limit) break;
  }
  return paths;
}

export interface ClipboardFiles {
  paths: string[];
  /** Whether the source asked for a move (cut). */
  cut: boolean;
}

/** Nautilus's format: "copy" or "cut" on the first line, then URIs. */
export function parseGnomeCopiedFiles(text: string): ClipboardFiles | null {
  const [verb, ...rest] = text.split(/\r?\n/);
  if (verb !== "copy" && verb !== "cut") return null;
  const paths = parseUriList(rest.join("\n"));
  return paths.length > 0 ? { paths, cut: verb === "cut" } : null;
}

/** Whether pasted text is a list of file URIs (a terminal or another app that offers them as text). */
export function looksLikeUriList(text: string): boolean {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "" && !line.startsWith("#"));
  return lines.length > 0 && lines.every((line) => line.trim().startsWith("file://"));
}

export interface SystemFiles {
  /** wl-copy is installed. */
  canWrite: boolean;
  write(paths: readonly string[]): Promise<boolean>;
  read(): Promise<ClipboardFiles | null>;
}

export function systemFiles(which: (program: string) => string | null = (program) => Bun.which(program), run: Exec = exec): SystemFiles {
  const copy = which("wl-copy");
  const paste = which("wl-paste");
  return {
    canWrite: copy !== null,
    async write(paths) {
      if (!copy || paths.length === 0) return false;
      // wl-copy takes the text on stdin; its --type names the one format it offers.
      return (await run([copy, "--type", URI_LIST], { input: encodeUriList(paths), quiet: true })).ok;
    },
    async read() {
      if (!paste) return null;
      const types = await run([paste, "--list-types"]);
      if (!types.ok) return null;
      const offered = types.stdout.split("\n").map((line) => line.trim());
      if (offered.includes(GNOME_FILES)) {
        const nautilus = await run([paste, "--no-newline", "--type", GNOME_FILES]);
        const parsed = nautilus.ok ? parseGnomeCopiedFiles(nautilus.stdout) : null;
        if (parsed) return parsed;
      }
      if (offered.includes(URI_LIST)) {
        const list = await run([paste, "--no-newline", "--type", URI_LIST]);
        const paths = list.ok ? parseUriList(list.stdout) : [];
        if (paths.length > 0) return { paths, cut: false };
      }
      return null;
    },
  };
}
