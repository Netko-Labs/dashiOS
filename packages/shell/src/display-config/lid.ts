/**
 * Whether the laptop's lid is shut, from systemd-logind (`LidClosed` on
 * `org.freedesktop.login1.Manager`, and its PropertiesChanged signal). With
 * the lid shut and a monitor attached the built-in panel goes dark
 * (plan.ts); logind itself ignores the lid then ("docked"), which is the
 * behavior Dashi wants (power/start.ts). Optional like the rest of power:
 * with no system bus, no logind, or a shell in a development window, there
 * is no lid and the panel stays as it is.
 */

import { powerOffReason } from "../power/index.ts";
import { type ConnectOptions, DBusConnection, getNameOwner, unwrap } from "../shared/dbus/index.ts";
import { LOGIND, MANAGER, MANAGER_PATH } from "../shared/logind/index.ts";

const PROPERTIES = "org.freedesktop.DBus.Properties";

export interface LidSource {
  /** Whether the lid is shut now. */
  readonly closed: boolean;
  /** Runs when the lid opens or shuts; returns the way to stop. */
  onChange(listener: (closed: boolean) => void): () => void;
  close(): void;
}

/** A lid that can be set by hand: tests, and `DASHI_LID` in development. */
export class ManualLid implements LidSource {
  closed: boolean;
  private readonly listeners = new Set<(closed: boolean) => void>();

  constructor(closed = false) {
    this.closed = closed;
  }

  set(closed: boolean): void {
    if (closed === this.closed) return;
    this.closed = closed;
    for (const listener of [...this.listeners]) listener(closed);
  }

  onChange(listener: (closed: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void {
    this.listeners.clear();
  }
}

export interface WatchLidOptions {
  bus?: ConnectOptions;
  /** Why to stay off, or null to run; defaults to `powerOffReason()`. */
  off?: string | null;
}

/** The lid, or null where there is none to watch (said once on stderr). */
export async function watchLid(options: WatchLidOptions = {}): Promise<LidSource | null> {
  const off = options.off === undefined ? powerOffReason() : options.off;
  if (off !== null) return null;
  let connection: DBusConnection | null = null;
  try {
    connection = await DBusConnection.connect({ bus: "system", ...options.bus });
    await getNameOwner(connection, LOGIND);
    const read = async (): Promise<boolean> => {
      const [value] = await (connection as DBusConnection).call({
        destination: LOGIND,
        path: MANAGER_PATH,
        interface: PROPERTIES,
        member: "Get",
        signature: "ss",
        body: [MANAGER, "LidClosed"],
      });
      return unwrap(value) === true;
    };
    const lid = new ManualLid(await read());
    const stop = await connection.subscribe(
      { type: "signal", sender: LOGIND, interface: PROPERTIES, member: "PropertiesChanged", path: MANAGER_PATH },
      (message) => {
        const [iface, changed] = message.body;
        if (iface === MANAGER && changed instanceof Map && changed.has("LidClosed")) lid.set(unwrap(changed.get("LidClosed")) === true);
      },
    );
    const owned = connection;
    return {
      get closed() {
        return lid.closed;
      },
      onChange: (listener) => lid.onChange(listener),
      close() {
        lid.close();
        void stop().catch(() => {});
        owned.close();
      },
    };
  } catch (error) {
    connection?.close();
    console.error(`dashi-shell: displays: no lid switch to follow: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}
