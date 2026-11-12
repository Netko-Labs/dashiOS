/**
 * The few libc calls D-Bus file-descriptor passing needs, through `bun:ffi`.
 * Bun's sockets read with plain `recv`, which throws away the ancillary data
 * a descriptor travels in (SCM_RIGHTS), so a connection that must receive one
 * owns its socket and reads it with `recvmsg` itself (fds.ts).
 *
 * The struct layouts below are Linux's on 64-bit (x86-64 and aarch64 agree).
 * The byte-level parts are pure functions, so they are tested without a socket.
 */

import { dlopen, FFIType, ptr, read } from "bun:ffi";

export const AF_UNIX = 1;
export const SOCK_STREAM = 1;
export const SOCK_NONBLOCK = 0o4000;
export const SOCK_CLOEXEC = 0o2000000;
const O_CLOEXEC = 0o2000000;
const SOL_SOCKET = 1;
const SCM_RIGHTS = 1;
/** Descriptors that arrive close on exec, so a process we spawn never inherits one. */
const MSG_CMSG_CLOEXEC = 0x40000000;
const MSG_DONTWAIT = 0x40;
const MSG_NOSIGNAL = 0x4000;
const MSG_CTRUNC = 0x8;

export const POLLIN = 0x1;
export const POLLOUT = 0x4;
export const POLLERR = 0x8;
export const POLLHUP = 0x10;
export const POLLNVAL = 0x20;

export const EAGAIN = 11;
export const EINTR = 4;

/** Most descriptors one `recvmsg` accepts; a D-Bus message here carries one or two. */
export const MAX_FDS = 16;

const CMSG_HEADER = 16;
const align8 = (n: number): number => (n + 7) & ~7;
/** `CMSG_SPACE` for `count` descriptors: the header and the padded payload. */
export const controlSpace = (count: number): number => CMSG_HEADER + align8(count * 4);

/** The ancillary data that sends `fds` (one SCM_RIGHTS message). */
export function encodeScmRights(fds: readonly number[]): Uint8Array {
  const out = new Uint8Array(controlSpace(fds.length));
  const view = new DataView(out.buffer);
  view.setBigUint64(0, BigInt(CMSG_HEADER + fds.length * 4), true);
  view.setInt32(8, SOL_SOCKET, true);
  view.setInt32(12, SCM_RIGHTS, true);
  for (const [index, fd] of fds.entries()) view.setInt32(CMSG_HEADER + index * 4, fd, true);
  return out;
}

/** The descriptors in `control[0..length]` as `recvmsg` filled it; other kinds of ancillary data are skipped. */
export function decodeScmRights(control: Uint8Array, length: number): number[] {
  const fds: number[] = [];
  const view = new DataView(control.buffer, control.byteOffset, control.byteLength);
  let at = 0;
  while (at + CMSG_HEADER <= length) {
    const size = Number(view.getBigUint64(at, true));
    if (size < CMSG_HEADER || at + size > length) break;
    if (view.getInt32(at + 8, true) === SOL_SOCKET && view.getInt32(at + 12, true) === SCM_RIGHTS) {
      for (let offset = at + CMSG_HEADER; offset + 4 <= at + size; offset += 4) fds.push(view.getInt32(offset, true));
    }
    at += align8(size);
  }
  return fds;
}

/** `struct sockaddr_un` for a filesystem path, and the length to pass with it. */
export function socketAddress(path: string): { bytes: Uint8Array; length: number } {
  const name = new TextEncoder().encode(path);
  if (name.length === 0 || name.length > 107 || name.includes(0)) throw new Error(`"${path}" is not a usable socket path`);
  const bytes = new Uint8Array(110);
  new DataView(bytes.buffer).setUint16(0, AF_UNIX, true);
  bytes.set(name, 2);
  return { bytes, length: 2 + name.length + 1 };
}

function open() {
  return dlopen("libc.so.6", {
    socket: { args: [FFIType.i32, FFIType.i32, FFIType.i32], returns: FFIType.i32 },
    socketpair: { args: [FFIType.i32, FFIType.i32, FFIType.i32, FFIType.ptr], returns: FFIType.i32 },
    connect: { args: [FFIType.i32, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
    close: { args: [FFIType.i32], returns: FFIType.i32 },
    pipe2: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
    poll: { args: [FFIType.ptr, FFIType.u64, FFIType.i32], returns: FFIType.i32 },
    sendmsg: { args: [FFIType.i32, FFIType.ptr, FFIType.i32], returns: FFIType.i64_fast },
    recvmsg: { args: [FFIType.i32, FFIType.ptr, FFIType.i32], returns: FFIType.i64_fast },
    // biome-ignore lint/style/useNamingConvention: libc's symbol
    __errno_location: { args: [], returns: FFIType.ptr },
  }).symbols;
}

let loaded: ReturnType<typeof open> | undefined;
/** libc, opened on first use: nothing here loads unless a descriptor has to pass. */
const libc = (): ReturnType<typeof open> => (loaded ??= open());

/** errno of the call that just failed; only for messages and EAGAIN. */
export function errno(): number {
  const where = libc().__errno_location();
  return where === null ? 0 : read.i32(where, 0);
}

export function closeFd(fd: number): void {
  libc().close(fd);
}

/** An AF_UNIX stream socket, non-blocking and close-on-exec, connected to `path`. */
export function connectUnix(path: string): number {
  const { bytes, length } = socketAddress(path);
  const fd = libc().socket(AF_UNIX, SOCK_STREAM | SOCK_NONBLOCK | SOCK_CLOEXEC, 0);
  if (fd < 0) throw new Error(`socket failed (errno ${errno()})`);
  if (libc().connect(fd, ptr(bytes), length) < 0) {
    const code = errno();
    closeFd(fd);
    throw new Error(`connecting to ${path} failed (errno ${code})`);
  }
  return fd;
}

/** A connected pair of AF_UNIX stream sockets (tests). */
export function socketPair(): [number, number] {
  const out = new Int32Array(2);
  if (libc().socketpair(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0, ptr(out)) < 0) throw new Error(`socketpair failed (errno ${errno()})`);
  return [out[0] as number, out[1] as number];
}

/** A pipe's read end and write end, both close-on-exec (tests). */
export function pipePair(): { read: number; write: number } {
  const out = new Int32Array(2);
  if (libc().pipe2(ptr(out), O_CLOEXEC) < 0) throw new Error(`pipe2 failed (errno ${errno()})`);
  return { read: out[0] as number, write: out[1] as number };
}

/** `poll` on one descriptor without waiting: which of `events` (plus errors and hang-up) are ready. */
export function pollNow(fd: number, events: number): number {
  return pollWait(fd, events, 0);
}

/**
 * `poll` on one descriptor for up to `timeoutMs` (-1: until something is
 * ready). It blocks the thread it runs on, so only a worker calls it with a
 * timeout (lib/fd-reader.ts).
 */
export function pollWait(fd: number, events: number, timeoutMs: number): number {
  const entry = new ArrayBuffer(8);
  const view = new DataView(entry);
  view.setInt32(0, fd, true);
  view.setInt16(4, events, true);
  const ready = libc().poll(ptr(new Uint8Array(entry)), 1n, timeoutMs);
  return ready > 0 ? view.getInt16(6, true) : 0;
}

/**
 * A `struct msghdr` over one data buffer and an optional control buffer, with
 * the one-entry `iovec` after it in the same allocation, so keeping the
 * returned buffer alive keeps all of it alive.
 */
function messageHeader(data: Uint8Array, control: Uint8Array | null): Uint8Array {
  const header = new Uint8Array(56 + 16);
  const view = new DataView(header.buffer);
  view.setBigUint64(16, BigInt(ptr(header, 56)), true);
  view.setBigUint64(24, 1n, true);
  if (control) {
    view.setBigUint64(32, BigInt(ptr(control)), true);
    view.setBigUint64(40, BigInt(control.length), true);
  }
  view.setBigUint64(56, BigInt(ptr(data)), true);
  view.setBigUint64(64, BigInt(data.length), true);
  return header;
}

/** Send `data` with `fds` attached; the count written, or 0 when the socket is full right now. */
export function sendWithFds(fd: number, data: Uint8Array, fds: readonly number[] = []): number {
  const control = fds.length > 0 ? encodeScmRights(fds) : null;
  const header = messageHeader(data, control);
  const sent = Number(libc().sendmsg(fd, ptr(header), MSG_DONTWAIT | MSG_NOSIGNAL));
  if (sent >= 0) return sent;
  const code = errno();
  if (code === EAGAIN || code === EINTR) return 0;
  throw new Error(`sending failed (errno ${code})`);
}

export interface Chunk {
  data: Uint8Array;
  fds: number[];
  /** The peer closed its end. */
  eof: boolean;
}

/**
 * Read what is waiting, with any descriptors that came with it (all
 * close-on-exec). Empty `data` and no `eof` means nothing was ready.
 */
export function receiveWithFds(fd: number, capacity = 16384): Chunk {
  const data = new Uint8Array(capacity);
  const control = new Uint8Array(controlSpace(MAX_FDS));
  const header = messageHeader(data, control);
  const got = Number(libc().recvmsg(fd, ptr(header), MSG_DONTWAIT | MSG_CMSG_CLOEXEC));
  if (got < 0) {
    const code = errno();
    if (code === EAGAIN || code === EINTR) return { data: new Uint8Array(0), fds: [], eof: false };
    throw new Error(`receiving failed (errno ${code})`);
  }
  const view = new DataView(header.buffer);
  const fds = decodeScmRights(control, Number(view.getBigUint64(40, true)));
  if (view.getInt32(48, true) & MSG_CTRUNC) {
    // More descriptors than we made room for: none of them can be trusted to be whole.
    for (const each of fds) closeFd(each);
    throw new Error("the peer sent more file descriptors than allowed");
  }
  return { data: data.slice(0, got), fds, eof: got === 0 };
}
