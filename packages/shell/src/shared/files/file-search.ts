/**
 * Files by name, from LocalSearch (the indexer GNOME uses, which keeps a
 * SPARQL database of the home folder). Files and the file chooser ask through
 * the `tinysparql` command (`searchFiles`), with the typed text as a bound
 * parameter, never spliced into the SPARQL; the launcher, which asks on every
 * keystroke, keeps one D-Bus connection instead (local-search.ts) and holds
 * it in `FileSearch`. A system without LocalSearch finds no files.
 */

import { basename, dirname } from "node:path";

/** What became of an ask that a newer one replaced before it ran. */
export const SUPERSEDED: unique symbol = Symbol("superseded");

/**
 * One ask in flight at a time: an ask made while one runs waits for it and
 * takes the place of any ask already waiting, which resolves `SUPERSEDED`
 * without running. Typing "terminal" asks LocalSearch for "te", then for
 * "terminal", and never for what was typed in between.
 */
export class LatestOnly<Query, Answer> {
  private running = false;
  private waiting: { query: Query; resolve: (answer: Answer | typeof SUPERSEDED) => void; reject: (error: unknown) => void } | null = null;

  constructor(private readonly run: (query: Query) => Promise<Answer>) {}

  ask(query: Query): Promise<Answer | typeof SUPERSEDED> {
    return new Promise((resolve, reject) => {
      this.waiting?.resolve(SUPERSEDED);
      this.waiting = { query, resolve, reject };
      this.next();
    });
  }

  private next(): void {
    if (this.running || !this.waiting) return;
    const { query, resolve, reject } = this.waiting;
    this.waiting = null;
    this.running = true;
    this.run(query)
      .then(resolve, reject)
      .finally(() => {
        this.running = false;
        this.next();
      });
  }
}

export interface FileHit {
  /** `file://` URL, as LocalSearch stores it. */
  url: string;
  path: string;
  name: string;
  /** The folder it is in, `~` for the home folder. */
  folder: string;
  /** MIME type, when LocalSearch knows it (`inode/directory` for a folder). */
  mime: string | null;
}

/** Typing fewer characters than this searches only apps. */
export const MIN_QUERY = 2;

const SPARQL = (limit: number) =>
  "SELECT DISTINCT ?url ?mime WHERE { ?f a nfo:FileDataObject ; nie:url ?url ; nfo:fileName ?name ; nfo:fileLastModified ?modified . " +
  "OPTIONAL { ?f nie:interpretedAs/nie:mimeType ?mime } FILTER(CONTAINS(LCASE(?name), LCASE(~q))) } " +
  `ORDER BY DESC(?modified) LIMIT ${limit}`;

/** The command that asks LocalSearch; `query` travels as the bound parameter `~q`. */
export function fileSearchCommand(query: string, limit: number): string[] {
  return ["tinysparql", "query", "-b", "org.freedesktop.LocalSearch3", "-a", `q:s:${query}`, "-q", SPARQL(limit)];
}

const MIME = /^[\w.+-]+\/[\w.+-]+$/;

/**
 * The hits in `tinysparql query` output: a `Results:` line, then one
 * indented `url, mime` per row (the URL is percent-encoded, so its own commas
 * come before the last `, `). Rows that are not local files are skipped.
 */
export function parseFileResults(output: string, home: string): FileHit[] {
  const lines = output.split("\n");
  const start = lines.findIndex((line) => line.trim() === "Results:");
  if (start < 0) return [];
  const seen = new Set<string>();
  return lines.slice(start + 1).flatMap((raw): FileHit[] => {
    const line = raw.trim();
    if (!line) return [];
    const comma = line.lastIndexOf(", ");
    const tail = comma >= 0 ? line.slice(comma + 2) : "";
    const url = comma >= 0 && (MIME.test(tail) || tail === "(null)") ? line.slice(0, comma) : line;
    const mime = MIME.test(tail) ? tail : null;
    if (!url.startsWith("file://") || seen.has(url)) return [];
    let path: string;
    try {
      path = decodeURIComponent(new URL(url).pathname);
    } catch {
      return [];
    }
    seen.add(url);
    const parent = dirname(path);
    const folder = parent === home ? "~" : parent.startsWith(`${home}/`) ? `~${parent.slice(home.length)}` : parent;
    return [{ url, path, name: basename(path), folder, mime }];
  });
}

/** Icon names to look up for a hit, most specific first. */
export function iconNamesFor(hit: Pick<FileHit, "mime">): string[] {
  if (!hit.mime) return ["text-x-generic"];
  if (hit.mime === "inode/directory") return ["folder"];
  const [kind] = hit.mime.split("/");
  return [hit.mime.replace("/", "-"), `${kind}-x-generic`, "text-x-generic"];
}

/** Ask LocalSearch for files named like `query`; empty for a short query or when it cannot be asked. */
export async function searchFiles(query: string, run: (command: readonly string[]) => Promise<string | null>, home: string, limit = 4): Promise<FileHit[]> {
  return (await askLocalSearch(query, run, home, limit)) ?? [];
}

/** `searchFiles`, but null when LocalSearch could not answer (not installed, not running). */
export async function askLocalSearch(
  query: string,
  run: (command: readonly string[]) => Promise<string | null>,
  home: string,
  limit = 4,
): Promise<FileHit[] | null> {
  const text = query.trim();
  if (text.length < MIN_QUERY) return [];
  const output = await run(fileSearchCommand(text, limit));
  return output === null ? null : parseFileResults(output, home).slice(0, limit);
}

/** After a failed ask, how long the launcher says "File search is off" before trying LocalSearch again. */
export const RETRY_MS = 60_000;

/**
 * File search as the launcher sees it: whether it can search right now (the
 * placeholder says so), and the search, one question at a time (a newer one
 * replaces one still waiting: launcher/budget.ts). Without LocalSearch it is
 * off for good; LocalSearch not answering is off for a minute, then asked again.
 * The launcher asks over one D-Bus connection (local-search.ts); Files and the
 * file chooser use `searchFiles` above.
 */
export class FileSearch {
  private failedAt: number | null = null;
  private readonly asks: LatestOnly<{ query: string; limit: number }, FileHit[] | null>;

  constructor(
    private readonly options: {
      /** Files named like `query`, best first, at most `limit`; null when LocalSearch couldn't answer. */
      ask: (query: string, limit: number) => Promise<FileHit[] | null>;
      /** Whether LocalSearch is installed; asked once. */
      installed: boolean;
      now?: () => number;
    },
  ) {
    this.asks = new LatestOnly(({ query, limit }) => options.ask(query, limit));
  }

  /** Whether a search could find files now. */
  isAvailable(): boolean {
    if (!this.options.installed) return false;
    if (this.failedAt === null) return true;
    return (this.options.now ?? Date.now)() - this.failedAt >= RETRY_MS;
  }

  /**
   * Files named like `query`, or null when file search is off. An ask a newer
   * one replaced before it ran is empty: whoever made it has moved on.
   */
  async find(query: string, limit = 4): Promise<FileHit[] | null> {
    if (!this.isAvailable()) return null;
    const text = query.trim();
    if (text.length < MIN_QUERY) return [];
    const hits = await this.asks.ask({ query: text, limit }).catch(() => null);
    if (hits === SUPERSEDED) return [];
    this.failedAt = hits === null ? (this.options.now ?? Date.now)() : null;
    return hits;
  }
}
