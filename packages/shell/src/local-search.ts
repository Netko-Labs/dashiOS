/**
 * The launcher's files, from LocalSearch over one D-Bus connection kept for
 * the session: no process per keystroke. The query goes to the endpoint's
 * `Query(s sparql, h pipe, a{sv} arguments) → as columns` with the typed text
 * as the bound parameter `~q`, never spliced into the SPARQL; the rows come
 * back through the pipe in TinySPARQL's cursor format (`parseCursor`).
 *
 * LocalSearch matches names that contain the text, newest first, and up to
 * `CANDIDATES` of them; they are ranked here by how the name matches (the
 * whole name, its start, a word's start, anywhere), then by how recently the
 * file changed (`rankFiles`).
 */

import { existsSync, read } from "node:fs";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import { closeFd, FdService, pipePair, variant } from "./shared/dbus/index.ts";
import type { FileHit } from "./shared/files/file-search.ts";

export const LOCAL_SEARCH = {
  name: "org.freedesktop.LocalSearch3",
  path: "/org/freedesktop/Tracker3/Endpoint",
  interface: "org.freedesktop.Tracker3.Endpoint",
} as const;

/** Names LocalSearch hands back to rank, newest first. */
export const CANDIDATES = 50;
/** Longer than this, an endpoint that hasn't answered is given up on. */
const QUERY_TIMEOUT_MS = 2000;
/** More cursor bytes than this is not a few file names. */
const MAX_CURSOR_BYTES = 1 << 22;

const SPARQL =
  "SELECT ?url ?mime ?modified WHERE { ?f a nfo:FileDataObject ; nie:url ?url ; nfo:fileName ?name ; nfo:fileLastModified ?modified . " +
  "OPTIONAL { ?f nie:interpretedAs/nie:mimeType ?mime } FILTER(CONTAINS(LCASE(?name), LCASE(~q))) } " +
  `ORDER BY DESC(?modified) LIMIT ${CANDIDATES}`;

/**
 * The rows of a TinySPARQL cursor: for each row, the column count, a type
 * and an end offset per column (int32s in the writer's byte order), then the
 * values, each ending in a NUL at its offset. An unbound value (type 0) is
 * null. Malformed bytes give null.
 */
export function parseCursor(bytes: Uint8Array, columns: number, littleEndian = isLittleEndian()): (string | null)[][] | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const rows: (string | null)[][] = [];
  let at = 0;
  while (at < bytes.length) {
    if (at + 4 > bytes.length) return null;
    const count = view.getInt32(at, littleEndian);
    at += 4;
    if (count === 0) break;
    if (count !== columns || at + count * 8 > bytes.length) return null;
    const types = Array.from({ length: count }, (_, i) => view.getInt32(at + i * 4, littleEndian));
    const ends = Array.from({ length: count }, (_, i) => view.getInt32(at + (count + i) * 4, littleEndian));
    at += count * 8;
    const size = (ends.at(-1) as number) + 1;
    if (size <= 0 || at + size > bytes.length) return null;
    const row: (string | null)[] = [];
    let start = 0;
    for (const [i, end] of ends.entries()) {
      if (end < start || end >= size || bytes[at + end] !== 0) return null;
      row.push(types[i] === 0 ? null : decoder.decode(bytes.subarray(at + start, at + end)));
      start = end + 1;
    }
    rows.push(row);
    at += size;
  }
  return rows;
}

const isLittleEndian = (): boolean => new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

const readChunk = promisify(read);

/** Everything until the writer closes `fd` (then closed too); null past `limit` bytes. */
export async function readToEnd(fd: number, limit = MAX_CURSOR_BYTES): Promise<Uint8Array | null> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const buffer = new Uint8Array(65536);
      const { bytesRead } = await readChunk(fd, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > limit) return null;
      chunks.push(buffer.subarray(0, bytesRead));
    }
  } finally {
    closeFd(fd);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** Whether LocalSearch is installed: the session bus can start it (its service file is in a data dir). */
export function hasLocalSearch(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  const dirs = [env.XDG_DATA_HOME ?? join(env.HOME ?? "", ".local/share"), ...(env.XDG_DATA_DIRS || "/usr/local/share:/usr/share").split(":")];
  return dirs.some((dir) => dir && existsSync(join(dir, "dbus-1/services", `${LOCAL_SEARCH.name}.service`)));
}

/** Asks one SPARQL endpoint; rows of strings, or null when it couldn't answer. */
export type AskSparql = (sparql: string, args: Readonly<Record<string, string>>) => Promise<(string | null)[][] | null>;

/**
 * LocalSearch's endpoint over one session-bus connection, made on the first
 * question and made again after it drops. A question it can't answer (not
 * installed, not running) is null.
 */
export class LocalSearchEndpoint {
  private connection: Promise<FdService> | null = null;

  constructor(private readonly connect: () => Promise<FdService> = () => FdService.connect({ bus: "session" })) {}

  readonly ask: AskSparql = async (sparql, args) => {
    let service: FdService;
    try {
      service = await this.service();
    } catch {
      return null;
    }
    const pipe = pipePair();
    const reading = readToEnd(pipe.read);
    try {
      const body = [sparql, 0, new Map(Object.entries(args).map(([key, value]) => [key, variant("s", value)]))];
      const [names] = await service.call(
        { destination: LOCAL_SEARCH.name, path: LOCAL_SEARCH.path, interface: LOCAL_SEARCH.interface, member: "Query", signature: "sha{sv}", body },
        QUERY_TIMEOUT_MS,
        [pipe.write],
      );
      const bytes = await reading;
      return Array.isArray(names) && bytes ? parseCursor(bytes, names.length) : null;
    } catch {
      // The write end went with the call (or was closed when it couldn't); the read sees its end.
      await reading.catch(() => null);
      return null;
    }
  };

  close(): void {
    void this.connection?.then((service) => service.close()).catch(() => {});
    this.connection = null;
  }

  private service(): Promise<FdService> {
    if (!this.connection) {
      const connecting = this.connect();
      this.connection = connecting;
      const forget = (): void => {
        if (this.connection === connecting) this.connection = null;
      };
      connecting.then((service) => service.onClose(forget), forget);
    }
    return this.connection;
  }
}

/** How a file's name matches the text: 0 the whole name (or before its extension), 1 its start, 2 a word's start, 3 anywhere. */
export function nameTier(name: string, query: string): number {
  const lower = name.toLowerCase();
  const text = query.toLowerCase();
  const stem = lower.includes(".") ? lower.slice(0, lower.lastIndexOf(".")) : lower;
  if (lower === text || stem === text) return 0;
  if (lower.startsWith(text)) return 1;
  if (new RegExp(`(?:^|[\\s._\\-(\\[])${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(lower)) return 2;
  return 3;
}

/** A hit with when it last changed (ms; 0 unknown). */
export interface DatedHit extends FileHit {
  modified: number;
}

/** Best name match first, the newest first among equals. */
export function rankFiles<Hit extends DatedHit>(hits: readonly Hit[], query: string): Hit[] {
  const tiers = new Map(hits.map((hit) => [hit, nameTier(hit.name, query)]));
  return [...hits].sort((a, b) => (tiers.get(a) as number) - (tiers.get(b) as number) || b.modified - a.modified);
}

/** A cursor row (`url, mime, modified`) as a hit; null for anything that isn't a local file. */
export function hitOf(row: readonly (string | null)[], home: string): DatedHit | null {
  const [url, mime, modified] = row;
  if (!url?.startsWith("file://")) return null;
  let path: string;
  try {
    path = decodeURIComponent(new URL(url).pathname);
  } catch {
    return null;
  }
  const parent = dirname(path);
  const folder = parent === home ? "~" : parent.startsWith(`${home}/`) ? `~${parent.slice(home.length)}` : parent;
  const time = modified ? Date.parse(modified) : Number.NaN;
  return { url, path, name: basename(path), folder, mime: mime && /^[\w.+-]+\/[\w.+-]+$/.test(mime) ? mime : null, modified: Number.isNaN(time) ? 0 : time };
}

/** Files named like `query`, ranked; null when LocalSearch couldn't answer. */
export async function findFiles(ask: AskSparql, query: string, home: string, limit: number): Promise<FileHit[] | null> {
  const rows = await ask(SPARQL, { q: query });
  if (rows === null) return null;
  const seen = new Set<string>();
  const hits = rows.flatMap((row) => {
    const hit = hitOf(row, home);
    if (!hit || seen.has(hit.url)) return [];
    seen.add(hit.url);
    return [hit];
  });
  return rankFiles(hits, query)
    .slice(0, limit)
    .map(({ modified: _, ...hit }) => hit);
}
