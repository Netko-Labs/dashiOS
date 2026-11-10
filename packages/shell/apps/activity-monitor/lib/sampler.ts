/**
 * Activity Monitor's reader, on a worker thread: every look at /proc
 * (read.ts, a few hundred small synchronous reads) happens here, so the
 * window's thread only applies the result. The main thread asks with a
 * `LookRequest` and gets the `Snapshot` back under the same id
 * (sampling.ts). What is known about each process (its name, command line
 * and app) is kept here between looks, and so are the installed apps the
 * processes are matched against (src/shared/processes/), read again every few
 * minutes so an app installed meanwhile is named.
 */

import { loadAppCatalog } from "../../../src/entries.ts";
import type { AppCatalog } from "../../../src/shared/processes/index.ts";
import { type ReadOptions, readerMemory, readSnapshot, type Snapshot, sysconf } from "../../../src/shared/processes/read.ts";

/** What a look reads beyond what the reader knows by itself. */
export type LookWants = Pick<ReadOptions, "io" | "sockets" | "kernel" | "energy">;

/** What the main thread sends: one look, and what it should read. */
export interface LookRequest {
  id: number;
  options: LookWants;
}

/** What this worker posts back. */
export type LookReply = { id: number; snapshot: Snapshot } | { id: number; error: string };

/** How long the installed apps are trusted before they are read again. */
const CATALOG_MS = 5 * 60_000;

declare const self: Worker;

const base: Omit<ReadOptions, keyof LookWants | "apps"> = {
  ownUid: process.getuid?.() ?? -1,
  pageSize: sysconf("PAGESIZE", 4096),
  memory: readerMemory(),
};
let catalog: { apps: AppCatalog; at: number } | null = null;

function apps(): AppCatalog | undefined {
  if (!catalog || Date.now() - catalog.at > CATALOG_MS) {
    try {
      catalog = { apps: loadAppCatalog(), at: Date.now() };
      // Processes are matched again against what is installed now.
      base.memory.known.clear();
    } catch {
      return catalog?.apps;
    }
  }
  return catalog.apps;
}

self.onmessage = (event: MessageEvent<LookRequest>) => {
  const { id, options } = event.data;
  let reply: LookReply;
  try {
    const found = apps();
    reply = { id, snapshot: readSnapshot({ ...base, ...options, ...(found ? { apps: found } : {}) }) };
  } catch (error) {
    reply = { id, error: error instanceof Error ? error.message : String(error) };
  }
  self.postMessage(reply);
};
