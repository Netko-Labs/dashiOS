/**
 * A client for dashi-comp's IPC (`$DASHI_COMP_SOCKET`, else
 * `$XDG_RUNTIME_DIR/dashi-comp.sock`): what Bun asks of the compositor and
 * what it hears back. Newline-delimited JSON; requests are answered by id.
 * The protocol is docs/compositor-ipc.md; every method is a typed method here
 * (`compositor.focus({ window })`), its params checked before they go and its
 * reply parsed as it comes, both with the shapes in src/compositor/ (H8).
 */

import { join } from "node:path";
import { isRecord, maybe, must } from "@dashi/shape";
import { EventShape } from "./compositor/events.ts";
import { type Calls, camel, METHODS, type MethodName } from "./compositor/table.ts";
import { FrameShape, GpuShape, IconShape, PointShape, WindowShape } from "./compositor/wire.ts";
import type { CompositorEvent, CompositorWindow, Frame, Gpu, Point, WindowIcon } from "./compositor-types.ts";
import { LineBuffer } from "./shared/io/lines.ts";

export type {
  AnimationTarget,
  CompositorEvent,
  CompositorWindow,
  Frame,
  Gpu,
  Output,
  Params,
  Placing,
  Point,
  ScreenEdge,
  Session,
  SuperPhase,
  WindowIcon,
} from "./compositor-types.ts";

/** The pointer in an IPC `session` answer; null when it is missing, null, or not a pair of finite numbers. */
export function parsePointer(answer: unknown): Point | null {
  return isRecord(answer) ? maybe(PointShape, answer.pointer) : null;
}

export const parseFrame = (value: unknown): Frame | null => maybe(FrameShape, value);

/** A window icon as the compositor sends it; null when it names neither a theme icon nor a picture. */
export const parseWindowIcon = (value: unknown): WindowIcon | null => maybe(IconShape, value) ?? null;

export const parseWindow = (value: unknown): CompositorWindow | null => maybe(WindowShape, value);

/** An event, or null for one this shell doesn't know or that doesn't parse. */
export const parseEvent = (value: unknown): CompositorEvent | null => maybe(EventShape, value);

export function parseGpus(value: unknown): Gpu[] {
  const list = isRecord(value) && Array.isArray(value.gpus) ? value.gpus : [];
  return list.flatMap((gpu) => maybe(GpuShape, gpu) ?? []);
}

type Pending = { resolve: (result: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };

/** How long a request waits for its reply unless it says otherwise. */
export const REQUEST_TIMEOUT_MS = 10_000;

export interface ConnectOptions {
  /** The socket; else `DASHI_COMP_SOCKET`, else `$XDG_RUNTIME_DIR/dashi-comp.sock`. */
  path?: string;
  /** How long a request waits for its reply (`REQUEST_TIMEOUT_MS`). */
  timeoutMs?: number;
}

/** The client: the socket, the requests waiting for their replies, and the event listeners. */
export class CompositorClient {
  private nextId = 0;
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Set<(event: CompositorEvent) => void>();
  private readonly closeListeners = new Set<() => void>();
  private readonly lines = new LineBuffer();
  private isClosed = false;

  protected constructor(
    private readonly socket: Bun.Socket<undefined>,
    private readonly timeoutMs: number,
  ) {}

  /** Connect and subscribe to events; null when dashi-comp isn't there. */
  static async connect(options: ConnectOptions = {}): Promise<Compositor | null> {
    const dir = process.env.XDG_RUNTIME_DIR;
    // DASHI_COMP_SOCKET: a compositor beside the session's (nested, tests) says where its socket is.
    const path = options.path || process.env.DASHI_COMP_SOCKET || (dir ? join(dir, "dashi-comp.sock") : null);
    if (!path) return null;
    let client: CompositorClient | null = null;
    try {
      const socket = await Bun.connect({
        unix: path,
        socket: {
          data: (_socket, data) => client?.receive(data),
          close: () => client?.closed(),
        },
      });
      client = new CompositorClient(socket, options.timeoutMs ?? REQUEST_TIMEOUT_MS);
      const compositor = withCalls(client);
      await compositor.subscribe();
      return compositor;
    } catch (error) {
      console.error("dashi-shell: no compositor IPC:", error);
      return null;
    }
  }

  /**
   * Ask dashi-comp as it is, unchecked: for a method this shell does not know.
   * Rejects with its error message, when no reply comes within `timeoutMs`,
   * and at once once the compositor has gone. The typed methods go through here.
   */
  request(method: string, params: Record<string, unknown> = {}, timeoutMs = this.timeoutMs): Promise<unknown> {
    if (this.isClosed) return Promise.reject(new Error("dashi-comp closed the connection"));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.delete(id)) return;
        reject(new Error(`dashi-comp: no reply to ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }

  on(listener: (event: CompositorEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private receive(chunk: Uint8Array): void {
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
      const event = parseEvent(message);
      if (event) this.dispatch(event);
    }
  }

  /** One listener that throws must not cost the others (or the rest of this chunk's events) their turn. */
  private dispatch(event: CompositorEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch (error) {
        console.error(`dashi-shell: a listener for “${event.event}” threw:`, error);
      }
    }
  }

  /** The compositor went away (it exited or crashed); runs once. */
  onClosed(listener: () => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  private closed(): void {
    if (this.isClosed) return;
    this.isClosed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("dashi-comp closed the connection"));
    }
    this.pending.clear();
    for (const listener of [...this.closeListeners]) listener();
    this.closeListeners.clear();
  }
}

/** The compositor: its client, and one typed method per IPC method. */
export type Compositor = CompositorClient & Calls;

export const Compositor = { connect: (options?: ConnectOptions): Promise<Compositor | null> => CompositorClient.connect(options) };

/** Ask `method` of `ask` (a client's `request`), its params checked and its reply parsed. */
export async function call<M extends MethodName>(ask: CompositorClient["request"], method: M, params: unknown = {}): Promise<unknown> {
  const spec = METHODS[method];
  const sent = must(spec.params, params, `${method} params`);
  return must(spec.reply, await ask(method, isRecord(sent) ? sent : {}), `${method} reply`);
}

/** The typed methods over any `request` (the client's, or a test's fake). */
export function callsOf(ask: CompositorClient["request"]): Calls {
  const calls: Record<string, (params?: unknown) => Promise<unknown>> = {};
  for (const method of Object.keys(METHODS) as MethodName[]) calls[camel(method)] = (params) => call(ask, method, params);
  return calls as Calls;
}

function withCalls(client: CompositorClient): Compositor {
  return Object.assign(
    client,
    callsOf((method, params, timeoutMs) => client.request(method, params, timeoutMs)),
  );
}
