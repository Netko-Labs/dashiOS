/**
 * Reading and writing a file's text for agents (read_text_file,
 * write_text_file): under the home folder and removable drives, never a
 * secret place (agent-place.ts, secret-places.ts). Reading is bounded (a
 * line range and a number of characters, with where to go on) and gives a
 * PDF's text through `pdftotext` when it is installed. Writing never
 * replaces a file unless asked to, and then the old one goes to the Trash
 * first: nothing is lost for good.
 */

import { appendFile, open, readFile, stat, writeFile } from "node:fs/promises";
import type { AgentPolicy } from "./agent.ts";
import { placeForAgent } from "./agent-place.ts";
import { type Exec, exec } from "./exec.ts";
import { quietContext } from "./ops.ts";
import { looksLikeText } from "./sniff.ts";
import { trashPaths } from "./trashops.ts";

/** The biggest file read whole (a line range of a bigger one is refused, in words). */
export const READ_MAX_BYTES = 20 * 1024 * 1024;
export const WRITE_MAX_CHARS = 5_000_000;

export interface TextRead {
  path: string;
  text: string;
  /** The first and last line given (from 1), and how many the file has. */
  from: number;
  to: number;
  lines: number;
  /** The line to go on from, when there is more. */
  next: number | null;
  /** "pdf" when the text came from a PDF. */
  kind: "text" | "pdf";
}

const isPdf = (path: string, head: Uint8Array): boolean => /\.pdf$/i.test(path) || new TextDecoder().decode(head.subarray(0, 5)) === "%PDF-";

async function textOf(path: string, run: Exec): Promise<{ text: string; kind: "text" | "pdf" } | { error: string }> {
  const info = await stat(path);
  if (info.size > READ_MAX_BYTES) return { error: `The file is ${Math.round(info.size / 1048576)} MB; Dashi reads files up to 20 MB.` };
  const handle = await open(path, "r");
  const head = new Uint8Array(8192);
  const { bytesRead } = await handle.read(head, 0, head.length, 0).finally(() => handle.close());
  const sample = head.subarray(0, bytesRead);
  if (isPdf(path, sample)) {
    if (!Bun.which("pdftotext"))
      return { error: "Reading a PDF's text needs pdftotext (in the poppler-utils package), which isn't installed. open_file shows it to the person." };
    const result = await run(["pdftotext", "-layout", "-q", "--", path, "-"], { timeoutMs: 20_000 });
    return result.ok ? { text: result.stdout, kind: "pdf" } : { error: "pdftotext couldn't read that PDF (it may be scanned, or locked with a password)." };
  }
  if (bytesRead > 0 && !looksLikeText(sample)) return { error: "That file isn't text (a picture, an archive, a program…): open_file shows it to the person." };
  return { text: await readFile(path, "utf8"), kind: "text" };
}

/** Lines `from` (1-based) on, at most `count` of them and `maxChars` characters, of a file an agent may read. */
export async function readTextForAgent(
  input: string,
  range: { from: number; count: number | null; maxChars: number },
  policy: AgentPolicy,
  run: Exec = exec,
): Promise<TextRead | { error: string }> {
  const place = await placeForAgent(input, policy);
  if (!place.ok) return { error: place.error };
  if (!place.exists) return { error: "There is no file at that path." };
  if (place.kind === "folder") return { error: "That is a folder: list_folder shows what is in it." };
  if (place.kind !== "file") return { error: "That isn't a plain file." };
  const got = await textOf(place.path, run).catch((error: unknown) => ({
    error: `It couldn't be read: ${error instanceof Error ? error.message : String(error)}`,
  }));
  if ("error" in got) return got;
  const all = got.text.split("\n");
  if (all.length > 1 && all.at(-1) === "") all.pop();
  const from = Math.min(Math.max(1, range.from), Math.max(1, all.length));
  const last = range.count === null ? all.length : Math.min(all.length, from + range.count - 1);
  const out: string[] = [];
  let size = 0;
  let to = from - 1;
  for (let index = from - 1; index < last; index++) {
    const line = all[index] ?? "";
    if (size + line.length + 1 > range.maxChars && out.length > 0) break;
    out.push(line.length > range.maxChars ? `${line.slice(0, range.maxChars)}…` : line);
    size += line.length + 1;
    to = index + 1;
  }
  return { path: place.path, text: out.join("\n"), from, to, lines: all.length, next: to < all.length ? to + 1 : null, kind: got.kind };
}

export type WriteMode = "create" | "replace" | "append";

/** Write `text` to a file an agent may write: a new file, a replacement (the old one to the Trash first), or added at its end. */
export async function writeTextForAgent(
  input: string,
  text: string,
  mode: WriteMode,
  policy: AgentPolicy,
  run: Exec = exec,
): Promise<{ path: string; created: boolean; trashed: boolean; bytes: number } | { error: string }> {
  if (text.length > WRITE_MAX_CHARS) return { error: "That is more than 5 million characters; write it in parts with append." };
  const place = await placeForAgent(input, policy);
  if (!place.ok) return { error: place.error };
  if (place.kind === "folder") return { error: "That path is a folder." };
  if (place.exists && place.kind !== "file") return { error: "Something that isn't a plain file is at that path." };
  const bytes = Buffer.byteLength(text);
  try {
    if (mode === "append") {
      await appendFile(place.path, text, { encoding: "utf8" });
      return { path: place.path, created: !place.exists, trashed: false, bytes };
    }
    if (place.exists && mode === "create") {
      return {
        error: "A file is already there. Say replace: true to put this in its place (the old one goes to the Trash), or append: true to add to its end.",
      };
    }
    let trashed = false;
    if (place.exists) {
      const result = await trashPaths([place.path], quietContext(), run);
      if (result.failed.length > 0) return { error: `The old file couldn't be moved to the Trash, so nothing was written: ${result.failed[0]?.reason ?? ""}` };
      trashed = true;
    }
    await writeFile(place.path, text, { encoding: "utf8", flag: "wx" });
    return { path: place.path, created: !place.exists, trashed, bytes };
  } catch (error) {
    return { error: `It couldn't be written: ${error instanceof Error ? error.message : String(error)}` };
  }
}
