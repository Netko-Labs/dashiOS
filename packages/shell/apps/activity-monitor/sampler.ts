/**
 * Activity Monitor's reader, on a worker thread: every look at /proc
 * (read.ts, a few hundred small synchronous reads) happens here, so the
 * window's thread only applies the result. The main thread asks with a
 * `LookRequest` and gets the `Snapshot` back under the same id
 * (sampling.ts). The names worked out from command lines are kept here,
 * between looks.
 */

import { type ReadOptions, readSnapshot, type Snapshot, sysconf } from "./read.ts";

/** What the main thread sends: one look, and what it should read. */
export interface LookRequest {
  id: number;
  options: Pick<ReadOptions, "io" | "sockets" | "kernel">;
}

/** What this worker posts back. */
export type LookReply = { id: number; snapshot: Snapshot } | { id: number; error: string };

declare const self: Worker;

const base: Omit<ReadOptions, "io" | "sockets" | "kernel"> = {
  ownUid: process.getuid?.() ?? -1,
  pageSize: sysconf("PAGESIZE", 4096),
  names: new Map(),
};

self.onmessage = (event: MessageEvent<LookRequest>) => {
  const { id, options } = event.data;
  let reply: LookReply;
  try {
    reply = { id, snapshot: readSnapshot({ ...base, ...options }) };
  } catch (error) {
    reply = { id, error: error instanceof Error ? error.message : String(error) };
  }
  self.postMessage(reply);
};
