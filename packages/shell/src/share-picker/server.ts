/**
 * The share picker's socket, `$XDG_RUNTIME_DIR/dashi-share.sock` (mode
 * 0600, the session's user only): one request line from
 * `dashi-share-picker`, one answer line back (protocol.ts). One picker at a
 * time: a second request while one is up is declined. A command that hangs
 * up (the portal gave up) closes its picker.
 */

import { chmodSync, existsSync, unlinkSync } from "node:fs";
import { LineBuffer } from "../lines.ts";
import { choiceLine, isPickRequest, MAX_LINE, type ShareChoice } from "./protocol.ts";

/** Ask the person; resolves with what they chose (null: declined). `abort` fires when the asker hangs up. */
export type Ask = (abort: AbortSignal) => Promise<ShareChoice | null>;

interface Pending {
  lines: LineBuffer;
  answered: boolean;
  abort: AbortController;
}

export function serveSharePicker(path: string, ask: Ask): () => void {
  if (existsSync(path)) unlinkSync(path);
  /** The connection whose picker is up. */
  let current: Pending | null = null;
  const answer = (socket: Bun.Socket<Pending>, choice: ShareChoice | null) => {
    if (socket.data.answered) return;
    socket.data.answered = true;
    const line = choice ? choiceLine(choice) : null;
    socket.write(`${JSON.stringify({ choice: line })}\n`);
    socket.end();
  };
  const listener = Bun.listen<Pending>({
    unix: path,
    socket: {
      open(socket) {
        socket.data = { lines: new LineBuffer(), answered: false, abort: new AbortController() };
      },
      data(socket, chunk) {
        if (socket.data.answered) return;
        const lines = socket.data.lines.push(chunk);
        if (socket.data.lines.pending > MAX_LINE) {
          answer(socket, null);
          return;
        }
        for (const line of lines) {
          if (line.length > MAX_LINE || !isPickRequest(line) || current !== null) {
            answer(socket, null);
            return;
          }
          const mine = socket.data;
          current = mine;
          void ask(mine.abort.signal)
            .catch((error) => {
              console.error("dashi-shell: the share picker:", error);
              return null;
            })
            .then((choice) => {
              if (current === mine) current = null;
              answer(socket, choice);
            });
          return;
        }
      },
      close(socket) {
        // Hung up: its picker closes, and the next may open even if this one's answer is slow to settle.
        if (current === socket.data) current = null;
        socket.data.abort.abort();
      },
    },
  });
  chmodSync(path, 0o600);
  return () => {
    listener.stop(true);
    if (existsSync(path)) unlinkSync(path);
  };
}
