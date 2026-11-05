/**
 * A long-lived D-Bus connection that receives file descriptors with method
 * calls, for a service whose callers pass them: the portal backend's Print
 * gets the document as a descriptor (apps/portal/). `DBusConnection` cannot
 * (Bun's sockets drop SCM_RIGHTS) and `FdConnection` polls, which is fine
 * for one short call but not for a service that waits all session.
 *
 * So this connection owns a plain socket (libc.ts): a worker thread blocks in
 * `poll` and reads it (fd-reader.ts), the main thread decodes, answers calls
 * from an `ObjectRegistry`, and writes. A call's descriptors are handed to its
 * handler (`CallContext.fds`) and closed once the handler has settled, so a
 * handler that keeps one dups or reads it before returning.
 */

import { type BusKind, busAddress, socketPaths } from "./address.ts";
import { AuthError, ClientAuth } from "./auth.ts";
import { BUS_NAME, BUS_PATH } from "./bus.ts";
import { DBusError, ERRORS, ProtocolError } from "./errors.ts";
import { exportedObject, replyMessage } from "./exported.ts";
import type { ReaderChunk, ReaderStart } from "./fd-reader.ts";
import type { InterfaceSpec } from "./introspect.ts";
import { closeFd, connectUnix, POLLERR, POLLHUP, POLLIN, POLLNVAL, pollNow, receiveWithFds, sendWithFds } from "./libc.ts";
import { MAX_MESSAGE } from "./marshal.ts";
import { decodeMessage, encodeMessage, Flags, FrameBuffer, type Message, MessageType } from "./message.ts";
import { ObjectRegistry } from "./object.ts";
import type { CallSpec, ExportedObject, SignalSpec } from "./types.ts";

const HANDSHAKE_MS = 10_000;
const CALL_TIMEOUT_MS = 25_000;
/** More descriptors than this waiting for their messages is a peer misbehaving. */
const MAX_PARKED_FDS = 64;
/** A peer that doesn't read can't make us queue more than this. */
const MAX_QUEUED_BYTES = 1 << 26;

interface Pending {
  resolve(body: unknown[]): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

/** Bytes waiting to be written, with descriptors for their first byte; `owned` ones are closed once sent. */
interface Outgoing {
  bytes: Uint8Array;
  fds: readonly number[];
  owned: boolean;
}

export interface FdServiceOptions {
  address?: string;
  bus?: BusKind;
}

export class FdService {
  uniqueName = "";
  private socket: number | null;
  private worker: Worker | null = null;
  private readonly frames = new FrameBuffer(MAX_MESSAGE);
  private parked: number[] = [];
  private serial = 0;
  private readonly pending = new Map<number, Pending>();
  private readonly registry = new ObjectRegistry();
  private readonly closeListeners = new Set<(error?: Error) => void>();
  private outgoing: Outgoing[] = [];
  private queued = 0;
  private retry: ReturnType<typeof setTimeout> | null = null;

  private constructor(socket: number) {
    this.socket = socket;
  }

  /** Connect with descriptor passing, start reading, and say Hello. Rejects on any failure. */
  static async connect(options: FdServiceOptions = {}): Promise<FdService> {
    const address = options.address ?? busAddress(options.bus ?? "session");
    const path = (address ? socketPaths(address) : [])[0];
    if (path === undefined) throw new Error(`no usable D-Bus address${address ? ` in "${address}"` : ""}`);
    const service = new FdService(connectUnix(path));
    try {
      await service.authenticate(performance.now() + HANDSHAKE_MS);
      service.startReading();
      const [name] = await service.call({ destination: BUS_NAME, path: BUS_PATH, interface: BUS_NAME, member: "Hello" }, HANDSHAKE_MS);
      if (typeof name !== "string") throw new ProtocolError("Hello did not return a name");
      service.uniqueName = name;
      return service;
    } catch (error) {
      service.close();
      throw error;
    }
  }

  get closed(): boolean {
    return this.socket === null;
  }

  onClose(listener: (error?: Error) => void): void {
    this.closeListeners.add(listener);
  }

  /** The handshake happens before the worker starts, so it reads the socket here, briefly polling. */
  private async authenticate(deadline: number): Promise<void> {
    const auth = new ClientAuth(process.getuid?.() ?? 0, true);
    this.write(auth.start());
    for (;;) {
      const socket = this.socket;
      if (socket === null) throw new AuthError("the connection closed during the handshake");
      const events = pollNow(socket, POLLIN);
      if (events & POLLNVAL) throw new AuthError("the bus socket is gone");
      if (events & (POLLIN | POLLHUP | POLLERR)) {
        const { data, fds, eof } = receiveWithFds(socket);
        for (const fd of fds) closeFd(fd);
        if (data.length > 0) {
          const step = auth.feed(data);
          if (step.send) this.write(step.send);
          if (step.done) {
            this.frames.push(step.done.rest);
            return;
          }
        } else if (eof) {
          throw new AuthError("the bus closed the connection during the handshake");
        }
      }
      if (performance.now() >= deadline) throw new AuthError("the bus did not answer the handshake in time");
      await Bun.sleep(1);
    }
  }

  private startReading(): void {
    const socket = this.socket;
    if (socket === null) return;
    const worker = new Worker(new URL("./fd-reader.ts", import.meta.url));
    this.worker = worker;
    worker.onmessage = (event: MessageEvent<ReaderChunk>) => this.receive(event.data);
    worker.onerror = (event) => this.shutdown(new Error(`the bus reader failed: ${event.message}`));
    // Like a socket, an open connection keeps the process alive; close() ends the reader.
    worker.postMessage({ socket } satisfies ReaderStart);
    // Anything that came with the handshake's last line.
    this.decode();
  }

  private receive(chunk: ReaderChunk): void {
    if (this.closed) {
      if ("fds" in chunk) for (const fd of chunk.fds) closeFd(fd);
      return;
    }
    if ("error" in chunk) return this.shutdown(new Error(chunk.error));
    this.parked.push(...chunk.fds);
    try {
      if (this.parked.length > MAX_PARKED_FDS) throw new ProtocolError("the peer sent too many file descriptors");
      this.frames.push(chunk.data);
      this.decode();
    } catch (error) {
      return this.shutdown(error instanceof Error ? error : new Error(String(error)));
    }
    if (chunk.eof) this.shutdown();
  }

  private decode(): void {
    for (let frame = this.frames.next(); frame; frame = this.frames.next()) {
      const message = decodeMessage(frame);
      const count = message.unixFds ?? 0;
      if (count > this.parked.length) throw new ProtocolError("a message declares more file descriptors than arrived");
      this.route(message, this.parked.splice(0, count));
    }
  }

  private route(message: Message, fds: number[]): void {
    switch (message.type) {
      case MessageType.MethodReturn:
      case MessageType.Error:
        for (const fd of fds) closeFd(fd);
        return this.settle(message);
      case MessageType.MethodCall:
        void this.serve(message, fds);
        return;
      default:
        // Signals: this connection subscribes to none; a broadcast it gets anyway (NameAcquired) is dropped.
        for (const fd of fds) closeFd(fd);
    }
  }

  private settle(message: Message): void {
    const pending = this.pending.get(message.replySerial as number);
    if (!pending) return;
    this.pending.delete(message.replySerial as number);
    clearTimeout(pending.timer);
    if (message.type === MessageType.MethodReturn) pending.resolve(message.body);
    else pending.reject(new DBusError(message.errorName as string, typeof message.body[0] === "string" ? message.body[0] : "", message.body));
  }

  private async serve(call: Message, fds: number[]): Promise<void> {
    try {
      const reply = await this.registry.handle(call, fds);
      if (call.flags & Flags.NoReplyExpected || this.closed) return;
      try {
        this.write(encodeMessage(replyMessage(call, reply, this.nextSerial())));
      } catch (error) {
        if (this.closed) return;
        const failure = { type: "error" as const, name: ERRORS.failed, message: error instanceof Error ? error.message : "bad reply" };
        this.write(encodeMessage(replyMessage(call, failure, this.nextSerial())));
      }
    } catch {
      // The connection is going away.
    } finally {
      for (const fd of fds) closeFd(fd);
    }
  }

  private nextSerial(): number {
    this.serial = this.serial >= 0xffffffff ? 1 : this.serial + 1;
    return this.serial;
  }

  /**
   * Call a method and resolve with the reply's values (descriptors in replies are closed).
   * `fds` go with the call (an `h` in the body is an index into them); they become the
   * connection's, closed here once they are sent, or when it closes first.
   */
  call(spec: CallSpec, timeoutMs = CALL_TIMEOUT_MS, fds: readonly number[] = []): Promise<unknown[]> {
    const serial = this.nextSerial();
    const message: Message = {
      type: MessageType.MethodCall,
      flags: spec.noReply ? Flags.NoReplyExpected : 0,
      serial,
      path: spec.path,
      member: spec.member,
      signature: spec.signature ?? "",
      body: [...(spec.body ?? [])],
      ...(spec.interface === undefined ? {} : { interface: spec.interface }),
      ...(spec.destination === undefined ? {} : { destination: spec.destination }),
      ...(fds.length > 0 ? { unixFds: fds.length } : {}),
    };
    let frame: Uint8Array;
    try {
      frame = encodeMessage(message);
    } catch (error) {
      for (const fd of fds) closeFd(fd);
      throw error;
    }
    if (spec.noReply) {
      this.write(frame, fds, true);
      return Promise.resolve([]);
    }
    return new Promise<unknown[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(serial);
        reject(new DBusError(ERRORS.noReply, `no reply to ${spec.member} within ${timeoutMs} ms`));
      }, timeoutMs);
      this.pending.set(serial, { resolve, reject, timer });
      try {
        this.write(frame, fds, true);
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
      ...(spec.destination === undefined ? {} : { destination: spec.destination }),
    };
    this.write(encodeMessage(message));
  }

  export(path: string, interfaces: readonly InterfaceSpec[]): ExportedObject {
    this.registry.add(path, interfaces);
    return exportedObject(path, this.registry, (signal) => this.emitSignal(signal));
  }

  // Output: a full socket keeps the rest queued and tries again a moment later.

  /** Queue `bytes` with `fds` on their first byte; `owned` descriptors are closed once sent (or on failure). */
  private write(bytes: Uint8Array, fds: readonly number[] = [], owned = false): void {
    const refuse = (error: DBusError): never => {
      if (owned) for (const fd of fds) closeFd(fd);
      throw error;
    };
    if (this.closed) refuse(new DBusError(ERRORS.disconnected, "the connection is closed"));
    if (this.queued + bytes.length > MAX_QUEUED_BYTES) {
      this.shutdown(new Error("the peer is not reading; output queue is full"));
      refuse(new DBusError(ERRORS.disconnected, "the connection is closed"));
    }
    this.outgoing.push({ bytes, fds, owned });
    this.queued += bytes.length;
    this.flush();
  }

  private flush(): void {
    const socket = this.socket;
    while (socket !== null && this.outgoing.length > 0) {
      const head = this.outgoing[0] as Outgoing;
      let sent: number;
      try {
        sent = sendWithFds(socket, head.bytes, head.fds);
      } catch (error) {
        return this.shutdown(error instanceof Error ? error : new Error(String(error)));
      }
      if (sent === 0) {
        this.retry ??= setTimeout(() => {
          this.retry = null;
          this.flush();
        }, 2);
        return;
      }
      this.queued -= sent;
      // The descriptors rode the first byte: the peer has its own copies now.
      if (head.owned) for (const fd of head.fds) closeFd(fd);
      if (sent < head.bytes.length) this.outgoing[0] = { bytes: head.bytes.subarray(sent), fds: [], owned: false };
      else this.outgoing.shift();
    }
  }

  close(): void {
    this.shutdown();
  }

  private shutdown(error?: Error): void {
    const socket = this.socket;
    if (socket === null) return;
    this.socket = null;
    if (this.retry) clearTimeout(this.retry);
    this.worker?.terminate();
    this.worker = null;
    closeFd(socket);
    for (const fd of this.parked.splice(0)) closeFd(fd);
    for (const { fds, owned } of this.outgoing.splice(0)) if (owned) for (const fd of fds) closeFd(fd);
    this.queued = 0;
    for (const [serial, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new DBusError(ERRORS.disconnected, error?.message ?? "the connection closed"));
      this.pending.delete(serial);
    }
    for (const listener of this.closeListeners) {
      try {
        listener(error);
      } catch (thrown) {
        console.error("dashi: a D-Bus close handler threw:", thrown);
      }
    }
  }
}
