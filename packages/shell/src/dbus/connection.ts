/**
 * One connection to a D-Bus bus: the socket, the handshake, and the traffic
 * after it. Method calls are matched to their replies by serial; signals go
 * to the handlers whose rules they match; calls to objects we export are
 * answered from the `ObjectRegistry`. Whatever a peer sends is parsed
 * strictly: a malformed message closes the connection (rejecting everything
 * still waiting on it) instead of being half-understood.
 *
 * File descriptors cannot be passed (Bun sockets don't carry them), so `h`
 * values are plain indexes and the bus is never asked to negotiate them. A call
 * that must return a descriptor uses `FdConnection` (fds.ts) instead.
 */

import { type BusKind, busAddress, socketPaths } from "./address.ts";
import { AuthError, ClientAuth } from "./auth.ts";
import { BUS_NAME, BUS_PATH } from "./bus.ts";
import { DBusError, ERRORS, ProtocolError } from "./errors.ts";
import { exportedObject, replyMessage } from "./exported.ts";
import type { InterfaceSpec } from "./introspect.ts";
import { MAX_MESSAGE } from "./marshal.ts";
import { decodeMessage, encodeMessage, Flags, FrameBuffer, type Message, MessageType } from "./message.ts";
import { ObjectRegistry, type Reply } from "./object.ts";
import { type MatchRule, SignalRouter } from "./signals.ts";
import { subscribeTo } from "./subscribe.ts";
import type { CallSpec, ExportedObject, SignalSpec } from "./types.ts";

export interface ConnectOptions {
  /** A bus address (`unix:path=…`). Overrides `bus`. */
  address?: string;
  /** Which well-known bus to join; the session bus by default. */
  bus?: BusKind;
  /** How long connecting, authenticating, and Hello may take. */
  timeoutMs?: number;
  /** The biggest message accepted from the peer. */
  maxMessage?: number;
}

interface Pending {
  resolve(body: unknown[]): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

const DEFAULT_CALL_TIMEOUT_MS = 25_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
/** A peer that doesn't read can't make us queue more than this. */
const MAX_QUEUED_BYTES = 1 << 26;

export class DBusConnection {
  /** Our unique name on the bus (`:1.42`), set once Hello is answered. */
  uniqueName = "";
  private socket: Bun.Socket<undefined> | null = null;
  private state: "auth" | "messages" | "closed" = "auth";
  private readonly auth = new ClientAuth(process.getuid?.() ?? 0);
  private onAuth: { done(): void; fail(error: Error): void } | null = null;
  private readonly frames: FrameBuffer;
  private serial = 0;
  private readonly pending = new Map<number, Pending>();
  private readonly router = new SignalRouter();
  private readonly registry = new ObjectRegistry();
  private readonly closeListeners = new Set<(error?: Error) => void>();
  private outgoing: Uint8Array[] = [];
  private queued = 0;

  private constructor(maxMessage: number) {
    this.frames = new FrameBuffer(maxMessage);
  }

  /** Connect, authenticate, and say Hello. Rejects on any failure. */
  static async connect(options: ConnectOptions = {}): Promise<DBusConnection> {
    const address = options.address ?? busAddress(options.bus ?? "session");
    const paths = address ? socketPaths(address) : [];
    if (paths.length === 0) throw new Error(`no usable D-Bus address${address ? ` in "${address}"` : ""}`);
    const timeoutMs = options.timeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    let lastError: unknown;
    for (const path of paths) {
      const connection = new DBusConnection(options.maxMessage ?? MAX_MESSAGE);
      try {
        await connection.open(path, timeoutMs);
        return connection;
      } catch (error) {
        lastError = error;
        connection.shutdown();
        if (error instanceof AuthError) break;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async open(path: string, timeoutMs: number): Promise<void> {
    this.state = "auth";
    const authenticated = new Promise<void>((resolve, reject) => {
      this.onAuth = { done: resolve, fail: reject };
    });
    // The handshake can fail before anything awaits it (the connect itself); that's reported by the throw there.
    authenticated.catch(() => {});
    // Connecting itself can't hang on a local socket, but a bus that accepts and
    // then says nothing can, so the timer covers the whole handshake.
    const timer = setTimeout(() => this.onAuth?.fail(new Error(`D-Bus handshake timed out after ${timeoutMs} ms`)), timeoutMs);
    try {
      this.socket = await Bun.connect<undefined>({
        unix: path,
        socket: {
          open: () => {},
          data: (_socket, chunk) => this.receive(chunk),
          drain: () => this.flush(),
          close: () => this.shutdown(),
          error: (_socket, error) => this.shutdown(error),
        },
      });
      this.write(this.auth.start());
      await authenticated;
      const [name] = await this.call({ destination: BUS_NAME, path: BUS_PATH, interface: BUS_NAME, member: "Hello" }, timeoutMs);
      if (typeof name !== "string") throw new ProtocolError("Hello did not return a name");
      this.uniqueName = name;
    } finally {
      clearTimeout(timer);
      this.onAuth = null;
    }
  }

  get closed(): boolean {
    return this.state === "closed";
  }

  /** Called once when the connection ends, with the error if it did not end by `close()`. */
  onClose(listener: (error?: Error) => void): void {
    this.closeListeners.add(listener);
  }

  close(): void {
    this.shutdown();
  }

  private shutdown(error?: Error): void {
    if (this.state === "closed") return;
    this.state = "closed";
    this.onAuth?.fail(error ?? new Error("D-Bus connection closed during the handshake"));
    const socket = this.socket;
    this.socket = null;
    try {
      socket?.end();
    } catch {
      // Already gone.
    }
    for (const [serial, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new DBusError(ERRORS.disconnected, error?.message ?? "the connection closed"));
      this.pending.delete(serial);
    }
    for (const listener of this.closeListeners) {
      try {
        listener(error);
      } catch (thrown) {
        console.error("dashi-shell: a D-Bus close handler threw:", thrown);
      }
    }
  }

  // Output: writes may be partial, so what the socket doesn't take waits for `drain`.

  private write(bytes: Uint8Array): void {
    if (this.state === "closed") throw new DBusError(ERRORS.disconnected, "the connection is closed");
    if (this.queued + bytes.length > MAX_QUEUED_BYTES) {
      this.shutdown(new Error("the peer is not reading; output queue is full"));
      throw new DBusError(ERRORS.disconnected, "the connection is closed");
    }
    this.outgoing.push(bytes);
    this.queued += bytes.length;
    this.flush();
  }

  private flush(): void {
    const socket = this.socket;
    while (socket && this.outgoing.length > 0) {
      const chunk = this.outgoing[0] as Uint8Array;
      const written = socket.write(chunk);
      if (written < 0) return this.shutdown(new Error("writing to the bus failed"));
      this.queued -= written;
      if (written < chunk.length) {
        this.outgoing[0] = chunk.subarray(written);
        return;
      }
      this.outgoing.shift();
    }
  }

  // Input.

  private receive(chunk: Uint8Array): void {
    if (this.state === "closed") return;
    try {
      if (this.state === "auth") {
        const step = this.auth.feed(chunk);
        if (step.send) this.write(step.send);
        if (!step.done) return;
        this.state = "messages";
        this.frames.push(step.done.rest);
        this.onAuth?.done();
      } else if (this.state === "messages") {
        this.frames.push(chunk);
      }
      for (let frame = this.frames.next(); frame; frame = this.frames.next()) {
        this.route(decodeMessage(frame));
      }
    } catch (error) {
      this.shutdown(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private route(message: Message): void {
    switch (message.type) {
      case MessageType.MethodReturn:
      case MessageType.Error:
        return this.settle(message);
      case MessageType.Signal:
        return this.router.dispatch(message);
      case MessageType.MethodCall:
        void this.serve(message);
    }
  }

  private settle(message: Message): void {
    const serial = message.replySerial as number;
    const pending = this.pending.get(serial);
    if (!pending) return;
    this.pending.delete(serial);
    clearTimeout(pending.timer);
    if (message.type === MessageType.MethodReturn) {
      pending.resolve(message.body);
    } else {
      const text = typeof message.body[0] === "string" ? message.body[0] : "";
      pending.reject(new DBusError(message.errorName as string, text, message.body));
    }
  }

  // Calls out.

  private nextSerial(): number {
    this.serial = this.serial >= 0xffffffff ? 1 : this.serial + 1;
    return this.serial;
  }

  /** Call a method and resolve with the reply's values. Rejects with a `DBusError` for error replies, timeouts, and a closed connection. */
  async call(spec: CallSpec, timeoutMs = DEFAULT_CALL_TIMEOUT_MS): Promise<unknown[]> {
    const serial = this.nextSerial();
    const message: Message = {
      type: MessageType.MethodCall,
      flags: (spec.noReply ? Flags.NoReplyExpected : 0) | (spec.interactive ? Flags.AllowInteractiveAuthorization : 0),
      serial,
      path: spec.path,
      member: spec.member,
      signature: spec.signature ?? "",
      body: [...(spec.body ?? [])],
    };
    if (spec.interface !== undefined) message.interface = spec.interface;
    if (spec.destination !== undefined) message.destination = spec.destination;
    const frame = encodeMessage(message);
    if (spec.noReply) {
      this.write(frame);
      return [];
    }
    return new Promise<unknown[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(serial);
        reject(new DBusError(ERRORS.noReply, `no reply to ${spec.member} within ${timeoutMs} ms`));
      }, timeoutMs);
      this.pending.set(serial, { resolve, reject, timer });
      try {
        this.write(frame);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(serial);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  emitSignal(spec: SignalSpec): void {
    const message: Message = {
      type: MessageType.Signal,
      flags: Flags.NoReplyExpected,
      serial: this.nextSerial(),
      path: spec.path,
      interface: spec.interface,
      member: spec.member,
      signature: spec.signature ?? "",
      body: [...(spec.body ?? [])],
    };
    if (spec.destination !== undefined) message.destination = spec.destination;
    this.write(encodeMessage(message));
  }

  // Signals in.

  /**
   * Receive the signals (or other messages) matching `rule`. Resolves once the
   * bus has the match installed, with a function that removes it.
   */
  subscribe(rule: MatchRule, handler: (message: Message) => void): Promise<() => Promise<void>> {
    return subscribeTo(this, this.router, rule, handler);
  }

  // Objects out.

  /** Answer calls to `path` with these interfaces. Exporting a path again adds to it. */
  export(path: string, interfaces: readonly InterfaceSpec[]): ExportedObject {
    this.registry.add(path, interfaces);
    return exportedObject(path, this.registry, (signal) => this.emitSignal(signal));
  }

  private async serve(call: Message): Promise<void> {
    const reply = await this.registry.handle(call);
    if (call.flags & Flags.NoReplyExpected || this.closed) return;
    try {
      this.write(encodeMessage(replyMessage(call, reply, this.nextSerial())));
    } catch (error) {
      if (this.closed) return;
      // The result didn't fit its declared type; fail the call rather than leave the caller to time out.
      const failure: Reply = { type: "error", name: ERRORS.failed, message: error instanceof Error ? error.message : "bad reply" };
      try {
        this.write(encodeMessage(replyMessage(call, failure, this.nextSerial())));
      } catch {
        // The connection is going away.
      }
    }
  }
}
