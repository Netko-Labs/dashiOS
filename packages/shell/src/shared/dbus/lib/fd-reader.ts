/**
 * The reading half of a `FdService` connection (fd-service.ts), on a worker
 * thread: it waits in `poll` until the bus socket has something, reads it
 * with the descriptors that came along (SCM_RIGHTS), and posts the bytes and
 * descriptor numbers to the main thread, which decodes them. Waiting blocks
 * only this thread, so the connection costs nothing while the bus is quiet.
 * Descriptors are process-wide, so a number read here is good on the main thread.
 */

import { POLLERR, POLLHUP, POLLIN, POLLNVAL, pollWait, receiveWithFds } from "../libc.ts";

/** What the main thread sends: the socket to read. */
export interface ReaderStart {
  socket: number;
}

/** What this worker posts: a chunk, or why it stopped. */
export type ReaderChunk = { data: Uint8Array; fds: number[]; eof: boolean } | { error: string };

declare const self: Worker;

self.onmessage = (event: MessageEvent<ReaderStart>) => {
  const { socket } = event.data;
  for (;;) {
    let chunk: ReaderChunk;
    try {
      const ready = pollWait(socket, POLLIN, -1);
      if (ready & POLLNVAL) chunk = { data: new Uint8Array(0), fds: [], eof: true };
      else if (!(ready & (POLLIN | POLLHUP | POLLERR))) continue;
      else chunk = receiveWithFds(socket, 65536);
    } catch (error) {
      chunk = { error: error instanceof Error ? error.message : String(error) };
    }
    if ("data" in chunk && chunk.data.length === 0 && chunk.fds.length === 0 && !chunk.eof) continue;
    self.postMessage(chunk);
    if ("error" in chunk || chunk.eof) return;
  }
};
