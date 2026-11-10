/**
 * logind inhibitor locks. `Manager.Inhibit` answers with a file descriptor,
 * and the lock is held for as long as that descriptor is open: closing it,
 * or the process dying, releases it. Bun's D-Bus connection cannot receive a
 * descriptor, so each lock is taken on its own short-lived connection that can
 * (dbus/fds.ts); the descriptor outlives that connection.
 *
 * The descriptor is close-on-exec, so nothing the shell spawns inherits the
 * lock and keeps it held after the shell lets go.
 */

import { closeFd, FdConnection, type FdConnectOptions } from "../../shared/dbus/index.ts";
import { LOGIND, MANAGER, MANAGER_PATH } from "../logind.ts";

export interface InhibitRequest {
  /** What is inhibited: `sleep`, `handle-power-key`, and the other logind names, joined with colons. */
  what: string;
  /** Who holds the lock and why: shown by `systemd-inhibit --list` and to other desktop components. */
  who: string;
  why: string;
  /** `delay` holds the action back for a few seconds at most; `block` stops logind acting at all. */
  mode: "delay" | "block";
}

/** A lock that is held until released. */
export interface HeldLock {
  /** Idempotent. */
  release(): void;
}

/** Takes a lock; rejects when logind or the bus cannot give one. */
export type TakeLock = (request: InhibitRequest) => Promise<HeldLock>;

/** Wraps the descriptor of a lock; closing it twice would close whatever reused the number, so it can only close once. */
export function holdDescriptor(fd: number): HeldLock {
  let open = true;
  return {
    release() {
      if (!open) return;
      open = false;
      closeFd(fd);
    },
  };
}

/** Takes locks from logind on the system bus (or the bus `options` name). */
export function logindLocks(options: FdConnectOptions = {}): TakeLock {
  return async (request) => {
    const connection = await FdConnection.connect({ bus: "system", ...options });
    try {
      const { body, fds } = await connection.call({
        destination: LOGIND,
        path: MANAGER_PATH,
        interface: MANAGER,
        member: "Inhibit",
        signature: "ssss",
        body: [request.what, request.who, request.why, request.mode],
      });
      const index = body[0];
      const lock = typeof index === "number" ? fds[index] : undefined;
      for (const fd of fds) if (fd !== lock) closeFd(fd);
      if (lock === undefined) throw new Error("Inhibit answered without a file descriptor");
      return holdDescriptor(lock);
    } finally {
      connection.close();
    }
  };
}
