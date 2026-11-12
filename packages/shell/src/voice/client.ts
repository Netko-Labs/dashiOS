/**
 * A client for dashi-voice's socket (docs/voice.md): newline-delimited JSON,
 * requests answered by id (they may come out of order), events after
 * `subscribe`. The service refuses agents; the shell is the person's own
 * process, and what agents ask goes through the shell's tools (`ask_person`).
 */

import { join } from "node:path";
import { isRecord, maybe } from "@dashi/shape";
import { LineBuffer } from "../shared/io/index.ts";
import { type VoiceEvent, VoiceEventShape } from "./lib/wire.ts";

/** What the voice controller needs of the service: a test hands in its own. */
export interface VoiceLink {
  /** Rejects with the service's own words (they are for the person), or when it has gone. */
  call(method: string, params?: Record<string, unknown>): Promise<unknown>;
  on(listener: (event: VoiceEvent) => void): () => void;
  /** The service went away; runs once. */
  onClosed(listener: () => void): () => void;
  close(): void;
}

/** A model loading can take a few seconds (`warm`, the first `listen`). */
const REQUEST_TIMEOUT_MS = 30_000;

/** Where the service listens: `DASHI_VOICE_SOCKET`, else `$XDG_RUNTIME_DIR/dashi-voice.sock`. */
export function voiceSocketPath(env: Readonly<Record<string, string | undefined>> = process.env): string | null {
  if (env.DASHI_VOICE_SOCKET) return env.DASHI_VOICE_SOCKET;
  return env.XDG_RUNTIME_DIR ? join(env.XDG_RUNTIME_DIR, "dashi-voice.sock") : null;
}

type Pending = { resolve: (result: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };

class SocketLink implements VoiceLink {
  private nextId = 0;
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Set<(event: VoiceEvent) => void>();
  private readonly closeListeners = new Set<() => void>();
  private readonly lines = new LineBuffer();
  private gone = false;
  socket: Bun.Socket<undefined> | null = null;

  call(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const socket = this.socket;
    if (this.gone || !socket) return Promise.reject(new Error("Voice isn't running."));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error("Voice didn't answer."));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      socket.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }

  on(listener: (event: VoiceEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onClosed(listener: () => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  close(): void {
    this.socket?.end();
    this.closed();
  }

  receive(chunk: Uint8Array): void {
    for (const line of this.lines.push(chunk)) {
      if (!line.trim()) continue;
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (!isRecord(message)) continue;
      const pending = typeof message.id === "number" ? this.pending.get(message.id) : undefined;
      if (pending && typeof message.id === "number") {
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (typeof message.error === "string") pending.reject(new Error(message.error));
        else pending.resolve(message.result);
        continue;
      }
      const event = maybe(VoiceEventShape, message);
      if (!event) continue;
      for (const listener of [...this.listeners]) {
        try {
          listener(event);
        } catch (error) {
          console.error(`dashi-shell: a listener for Voice's “${event.event}” threw:`, error);
        }
      }
    }
  }

  closed(): void {
    if (this.gone) return;
    this.gone = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Voice isn't running."));
    }
    this.pending.clear();
    for (const listener of [...this.closeListeners]) listener();
    this.closeListeners.clear();
  }
}

/** Connect and subscribe; null when the service isn't there. */
export async function connectVoice(path: string | null = voiceSocketPath()): Promise<VoiceLink | null> {
  if (!path) return null;
  const link = new SocketLink();
  try {
    link.socket = await Bun.connect({
      unix: path,
      socket: {
        data: (_socket, data) => link.receive(data),
        close: () => link.closed(),
        error: () => link.closed(),
      },
    });
    await link.call("subscribe");
    return link;
  } catch {
    link.close();
    return null;
  }
}
