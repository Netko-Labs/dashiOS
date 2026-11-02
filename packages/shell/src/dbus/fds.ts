/**
 * A D-Bus connection that can carry file descriptors, for the few calls that
 * return one (logind's `Inhibit` hands back the lock as a descriptor). Bun's
 * sockets cannot receive SCM_RIGHTS, so this connection owns a plain
 * non-blocking socket and reads it through libc (libc.ts).
 *
 * It is not a second `DBusConnection`: nothing in the event loop watches its
 * socket, so each wait polls for a moment and sleeps a millisecond. That is
 * fine for a call that takes a few milliseconds and happens at startup and at
 * resume; a connection that stays open (signals, exported objects) belongs on
 * `DBusConnection`. Open one, make the call, close it: a descriptor that came
 * back does not depend on the connection it arrived on.
 */

import { type BusKind, busAddress, socketPaths } from "./address.ts";
import { AuthError, ClientAuth } from "./auth.ts";
import { BUS_NAME, BUS_PATH } from "./bus.ts";
import { DBusError, ERRORS, ProtocolError } from "./errors.ts";
import { type Chunk, closeFd, connectUnix, POLLERR, POLLHUP, POLLIN, POLLNVAL, pollNow, receiveWithFds, sendWithFds } from "./libc.ts";
import { MAX_MESSAGE } from "./marshal.ts";
import { decodeMessage, encodeMessage, Flags, FrameBuffer, type Message, MessageType } from "./message.ts";
import type { CallSpec } from "./types.ts";

const DEFAULT_TIMEOUT_MS = 5000;
/** Pause between looks at the socket while waiting. */
const TICK_MS = 1;
/** More descriptors than this waiting for messages is a peer misbehaving. */
const MAX_PARKED_FDS = 32;

/** A message with the descriptors that came with it (now ours to close). */
export interface Received {
  message: Message;
  fds: number[];
}

export interface FdConnectOptions {
  /** A bus address (`unix:path=…`). Overrides `bus`. */
  address?: string;
  bus?: BusKind;
  /** How long connecting, authenticating, and Hello may take. */
  timeoutMs?: number;
}

const now = (): number => performance.now();

export class FdConnection {
  uniqueName = "";
  private socket: number | null;
  private readonly frames = new FrameBuffer(MAX_MESSAGE);
  /** Descriptors read off the socket that no decoded message has claimed yet. */
  private parked: number[] = [];
  private ready: Received[] = [];
  private serial = 0;

  private constructor(socket: number) {
    this.socket = socket;
  }

  /** Connect, authenticate with descriptor passing, and say Hello. Rejects on any failure. */
  static async connect(options: FdConnectOptions = {}): Promise<FdConnection> {
    const address = options.address ?? busAddress(options.bus ?? "system");
    const path = (address ? socketPaths(address) : [])[0];
    if (path === undefined) throw new Error(`no usable D-Bus address${address ? ` in "${address}"` : ""}`);
    const deadline = now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const connection = new FdConnection(connectUnix(path));
    try {
      await connection.authenticate(deadline);
      const [name] = (await connection.call({ destination: BUS_NAME, path: BUS_PATH, interface: BUS_NAME, member: "Hello" }, deadline - now())).body;
      if (typeof name !== "string") throw new ProtocolError("Hello did not return a name");
      connection.uniqueName = name;
      return connection;
    } catch (error) {
      connection.close();
      throw error;
    }
  }

  get closed(): boolean {
    return this.socket === null;
  }

  private async authenticate(deadline: number): Promise<void> {
    const auth = new ClientAuth(process.getuid?.() ?? 0, true);
    this.write(auth.start());
    for (;;) {
      const chunk = await this.waitForData(deadline);
      const step = auth.feed(chunk);
      if (step.send) this.write(step.send);
      if (step.done) {
        this.frames.push(step.done.rest);
        return;
      }
    }
  }

  /** Raw bytes for the handshake (before there are messages to decode). */
  private async waitForData(deadline: number): Promise<Uint8Array> {
    for (;;) {
      const { data, fds, eof } = this.read();
      for (const fd of fds) closeFd(fd);
      if (data.length > 0) return data;
      if (eof) throw new AuthError("the bus closed the connection during the handshake");
      if (now() >= deadline) throw new AuthError("the bus did not answer the handshake in time");
      await Bun.sleep(TICK_MS);
    }
  }

  /** One non-blocking read. A hang-up with nothing left to read is end of file. */
  private read(): Chunk {
    const socket = this.socket;
    if (socket === null) return { data: new Uint8Array(0), fds: [], eof: true };
    const events = pollNow(socket, POLLIN);
    if (events & POLLNVAL) return { data: new Uint8Array(0), fds: [], eof: true };
    if (!(events & (POLLIN | POLLHUP | POLLERR))) return { data: new Uint8Array(0), fds: [], eof: false };
    return receiveWithFds(socket);
  }

  /** Writes all of `bytes`, with `fds` riding on the first byte. */
  private write(bytes: Uint8Array, fds: readonly number[] = []): void {
    const socket = this.socket;
    if (socket === null) throw new DBusError(ERRORS.disconnected, "the connection is closed");
    let offset = 0;
    let attached = fds;
    // A message this small fits the socket buffer at once; a full buffer for a
    // few retries means the peer is not reading.
    for (let tries = 0; offset < bytes.length; ) {
      const sent = sendWithFds(socket, bytes.subarray(offset), attached);
      if (sent > 0) {
        offset += sent;
        attached = [];
        tries = 0;
      } else if (++tries > 100) {
        throw new DBusError(ERRORS.disconnected, "the peer is not reading");
      }
    }
  }

  send(message: Omit<Message, "serial">, fds: readonly number[] = []): number {
    this.serial = this.serial >= 0xffffffff ? 1 : this.serial + 1;
    const serial = this.serial;
    this.write(encodeMessage({ ...message, serial, ...(fds.length > 0 ? { unixFds: fds.length } : {}) }), fds);
    return serial;
  }

  /** Every complete message that has arrived, without waiting. A malformed one closes the connection and throws. */
  drain(): Received[] {
    this.fill();
    return this.ready.splice(0);
  }

  /** The next message, waiting up to `timeoutMs`; rejects when none comes or the connection ends first. */
  async receive(timeoutMs: number): Promise<Received> {
    const deadline = now() + timeoutMs;
    for (;;) {
      this.fill();
      const next = this.ready.shift();
      if (next) return next;
      if (this.closed) throw new DBusError(ERRORS.disconnected, "the connection closed");
      if (now() >= deadline) throw new DBusError(ERRORS.noReply, `nothing arrived within ${timeoutMs} ms`);
      await Bun.sleep(TICK_MS);
    }
  }

  /**
   * Call a method and wait for its reply: the values and the descriptors that
   * came with it (the caller closes those). Other messages are dropped.
   */
  async call(spec: CallSpec, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<{ body: unknown[]; fds: number[] }> {
    const deadline = now() + timeoutMs;
    const serial = this.send({
      type: MessageType.MethodCall,
      flags: 0,
      path: spec.path,
      member: spec.member,
      signature: spec.signature ?? "",
      body: [...(spec.body ?? [])],
      ...(spec.interface === undefined ? {} : { interface: spec.interface }),
      ...(spec.destination === undefined ? {} : { destination: spec.destination }),
    });
    for (;;) {
      const { message, fds } = await this.receive(Math.max(0, deadline - now()));
      if (message.replySerial !== serial || (message.type !== MessageType.MethodReturn && message.type !== MessageType.Error)) {
        for (const fd of fds) closeFd(fd);
        continue;
      }
      if (message.type === MessageType.Error) {
        for (const fd of fds) closeFd(fd);
        const text = typeof message.body[0] === "string" ? message.body[0] : "";
        throw new DBusError(message.errorName as string, text, message.body);
      }
      return { body: message.body, fds };
    }
  }

  /** Answer a call (a service built on this connection, as the tests' fake logind is). */
  reply(call: Message, signature = "", body: readonly unknown[] = [], fds: readonly number[] = []): void {
    this.send(
      {
        type: MessageType.MethodReturn,
        flags: Flags.NoReplyExpected,
        replySerial: call.serial,
        signature,
        body: [...body],
        ...(call.sender === undefined ? {} : { destination: call.sender }),
      },
      fds,
    );
  }

  /** Hang up and give back everything not yet handed out. */
  close(): void {
    this.hangUp();
    for (const fd of this.parked.splice(0)) closeFd(fd);
    for (const { fds } of this.ready.splice(0)) for (const fd of fds) closeFd(fd);
  }

  private hangUp(): void {
    const socket = this.socket;
    this.socket = null;
    if (socket !== null) closeFd(socket);
  }

  /** Read everything waiting and cut it into messages, matching descriptors to the messages that declare them. */
  private fill(): void {
    try {
      for (;;) {
        const { data, fds, eof } = this.read();
        this.parked.push(...fds);
        if (this.parked.length > MAX_PARKED_FDS) throw new ProtocolError("the peer sent too many file descriptors");
        this.frames.push(data);
        for (let frame = this.frames.next(); frame; frame = this.frames.next()) {
          const message = decodeMessage(frame);
          const count = message.unixFds ?? 0;
          if (count > this.parked.length) throw new ProtocolError("a message declares more file descriptors than arrived");
          this.ready.push({ message, fds: this.parked.splice(0, count) });
        }
        if (eof) return this.hangUp();
        if (data.length === 0) return;
      }
    } catch (error) {
      this.close();
      throw error;
    }
  }
}
