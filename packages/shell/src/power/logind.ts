/**
 * The parts of systemd-logind (`org.freedesktop.login1` on the system bus)
 * the shell uses: whether the machine is about to sleep, this session's
 * lock requests and lock hint, and suspending, restarting, and powering off. Locks that need a file
 * descriptor are inhibit.ts's.
 */

import { type ConnectOptions, DBusConnection, DBusError, getNameOwner } from "../shared/dbus/index.ts";

export const LOGIND = "org.freedesktop.login1";
export const MANAGER_PATH = "/org/freedesktop/login1";
export const MANAGER = "org.freedesktop.login1.Manager";
export const SESSION = "org.freedesktop.login1.Session";

/** The Manager methods that end or pause the machine. */
export type MachineMethod = "Suspend" | "Reboot" | "PowerOff";

/** logind's session paths: the manager's path and the session's id, which is letters, digits, and underscores. */
const SESSION_PATH = /^\/org\/freedesktop\/login1\/session\/[A-Za-z0-9_]{1,64}$/;
/** A session id as `XDG_SESSION_ID` carries it. */
const SESSION_ID = /^[A-Za-z0-9_-]{1,32}$/;

export class Logind {
  private constructor(private readonly connection: DBusConnection) {}

  /** Connects to the system bus; rejects when there is no bus or no logind on it. */
  static async connect(options: ConnectOptions = {}): Promise<Logind> {
    const connection = await DBusConnection.connect({ bus: "system", ...options });
    try {
      await getNameOwner(connection, LOGIND);
    } catch (error) {
      connection.close();
      throw error instanceof DBusError ? new Error("systemd-logind is not running") : error;
    }
    return new Logind(connection);
  }

  get closed(): boolean {
    return this.connection.closed;
  }

  onClose(listener: (error?: Error) => void): void {
    this.connection.onClose(listener);
  }

  close(): void {
    this.connection.close();
  }

  /** `PrepareForSleep`: true just before the machine sleeps, false once it is awake. */
  async onPrepareForSleep(handler: (sleeping: boolean) => void): Promise<() => Promise<void>> {
    return this.connection.subscribe({ type: "signal", sender: LOGIND, interface: MANAGER, member: "PrepareForSleep", path: MANAGER_PATH }, (message) => {
      if (typeof message.body[0] === "boolean") handler(message.body[0]);
    });
  }

  /** This process's session: the one it belongs to, else `XDG_SESSION_ID`'s. Null when logind does not know it. */
  async findSession(pid: number, sessionId: string | undefined): Promise<string | null> {
    const attempts: Array<() => Promise<unknown[]>> = [() => this.manager("GetSessionByPID", "u", [pid])];
    if (sessionId && SESSION_ID.test(sessionId)) attempts.push(() => this.manager("GetSession", "s", [sessionId]));
    for (const attempt of attempts) {
      try {
        const [path] = await attempt();
        if (typeof path === "string" && SESSION_PATH.test(path)) return path;
      } catch (error) {
        if (!(error instanceof DBusError)) throw error;
      }
    }
    return null;
  }

  /** `Lock` on the session: someone ran `loginctl lock-session`. (`Unlock` is deliberately not offered: only the password unlocks.) */
  async onSessionLock(session: string, handler: () => void): Promise<() => Promise<void>> {
    return this.connection.subscribe({ type: "signal", sender: LOGIND, interface: SESSION, member: "Lock", path: session }, () => handler());
  }

  /** Tells logind and everything watching it whether the screen is locked. */
  async setLockedHint(session: string, locked: boolean): Promise<void> {
    await this.connection.call({ destination: LOGIND, path: session, interface: SESSION, member: "SetLockedHint", signature: "b", body: [locked] });
  }

  /** `Manager.Suspend`; not interactive, so it never waits on a password prompt. */
  async suspend(): Promise<void> {
    await this.machine("Suspend");
  }

  /**
   * `Manager.Suspend`, `Reboot`, or `PowerOff`. Not interactive: logind's policy lets the
   * person at the machine do it, and anything else is refused rather than asked.
   */
  async machine(method: MachineMethod): Promise<void> {
    await this.manager(method, "b", [false]);
  }

  private manager(member: string, signature: string, body: unknown[]): Promise<unknown[]> {
    return this.connection.call({ destination: LOGIND, path: MANAGER_PATH, interface: MANAGER, member, signature, body });
  }
}
