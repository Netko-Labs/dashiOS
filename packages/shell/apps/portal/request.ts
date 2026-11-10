/**
 * The Request and Session objects of the portal backend API. For each call
 * that shows something, xdg-desktop-portal names an object path (`handle`)
 * the backend exports for as long as the call runs; `Close` on it means the
 * app gave up (or went away), and the dialog goes. A Session (the Inhibit
 * monitor) lives until either side closes it.
 */

import { DBusError, ERRORS, type ExportedObject, type InterfaceSpec, isObjectPath } from "../../src/shared/dbus/index.ts";

export const REQUEST = "org.freedesktop.impl.portal.Request";
export const SESSION = "org.freedesktop.impl.portal.Session";

/** A portal response code: 0 done, 1 cancelled by the person, 2 ended some other way. */
export const Response = { success: 0, cancelled: 1, other: 2 } as const;
export type ResponseCode = (typeof Response)[keyof typeof Response];

export interface Exporter {
  export(path: string, interfaces: readonly InterfaceSpec[]): ExportedObject;
}

/** The handle argument, checked: an object path, not one already in use. */
export function handlePath(value: unknown): string {
  if (typeof value !== "string" || !isObjectPath(value) || value === "/") throw new DBusError(ERRORS.invalidArgs, "the handle is not an object path");
  return value;
}

export class Requests {
  private readonly open = new Map<string, AbortController>();

  constructor(private readonly bus: Exporter) {}

  get count(): number {
    return this.open.size;
  }

  /** Runs `work` with a Request at `handle`; its Close aborts `signal`. The object goes when the work is done. */
  async run<T>(handle: unknown, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const path = handlePath(handle);
    if (this.open.has(path)) throw new DBusError(ERRORS.invalidArgs, "that request is already open");
    const controller = new AbortController();
    this.open.set(path, controller);
    const object = this.bus.export(path, [
      {
        name: REQUEST,
        methods: { Close: { handler: () => controller.abort() } },
      },
    ]);
    try {
      return await work(controller.signal);
    } finally {
      this.open.delete(path);
      object.unexport();
    }
  }

  /** Close every open request (the backend is going away). */
  closeAll(): void {
    for (const controller of this.open.values()) controller.abort();
  }
}

export interface Session {
  readonly path: string;
  /** Emit one of the session's signals. */
  object: ExportedObject;
  close(): void;
}

/** Exports a Session at `handle`; `onClose` runs once, whoever closes it. */
export function openSession(bus: Exporter, handle: unknown, onClose: () => void): Session {
  const path = handlePath(handle);
  let open = true;
  const close = () => {
    if (!open) return;
    open = false;
    object.unexport();
    onClose();
  };
  const object = bus.export(path, [
    {
      name: SESSION,
      methods: { Close: { handler: () => close() } },
      signals: { Closed: "" },
      properties: { version: { type: "u", get: () => 1 } },
    },
  ]);
  return {
    path,
    object,
    close() {
      if (!open) return;
      object.emit(SESSION, "Closed");
      close();
    },
  };
}
