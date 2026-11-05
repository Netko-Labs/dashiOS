/**
 * The portal's Inhibit (org.freedesktop.impl.portal.Inhibit): an app keeping
 * the screen awake, or the computer from sleeping or logging out. The hold
 * itself is the shell's, which decides what idle does (src/inhibit/); this
 * hands it over and keeps the Request object the hold lives on. xdg-desktop-
 * portal closes that Request when the app lets go or leaves the bus, and the
 * hold goes with it; if this process dies, the shell drops its holds itself.
 *
 * CreateMonitor answers with a session that says the session is running and
 * the screen saver is off: Dashi never asks apps before logging out.
 */

import { DBusError, ERRORS, type InterfaceSpec, type Variant, variant } from "../../src/dbus/index.ts";
import { type Exporter, handlePath, openSession, REQUEST, Response, type Session } from "./request.ts";
import type { ShellLink } from "./shell.ts";
import { str, vardict } from "./vardict.ts";

export const INHIBIT = "org.freedesktop.impl.portal.Inhibit";

/** The session states a monitor reports. */
const RUNNING = 1;

export interface InhibitDeps {
  bus: Exporter;
  shell: ShellLink;
  /** Emits StateChanged on the portal's own object, where the Inhibit interface is. */
  stateChanged: (session: string, state: Map<string, Variant>) => void;
  /** Runs work after the current reply has gone (a timer; tests run it at once). */
  later?: (work: () => void) => void;
}

export class InhibitBackend {
  /** Each open Request, and the shell's id for its hold once the shell has answered. */
  private readonly holds = new Map<string, { id: number | null; closed: boolean }>();
  private readonly sessions = new Map<string, Session>();

  constructor(private readonly deps: InhibitDeps) {}

  get held(): number {
    return this.holds.size;
  }

  async inhibit(handle: unknown, appId: string, flags: number, options: unknown): Promise<void> {
    const path = handlePath(handle);
    if (this.holds.has(path)) throw new DBusError(ERRORS.invalidArgs, "that request is already open");
    const reason = str(vardict(options), "reason") ?? "";
    const entry = { id: null as number | null, closed: false };
    this.holds.set(path, entry);
    const object = this.deps.bus.export(path, [
      {
        name: REQUEST,
        methods: {
          Close: {
            handler: async () => {
              entry.closed = true;
              this.holds.delete(path);
              object.unexport();
              if (entry.id !== null) await this.deps.shell.uninhibit(entry.id).catch(() => {});
            },
          },
        },
      },
    ]);
    try {
      entry.id = await this.deps.shell.inhibit(appId, reason, flags);
    } catch (error) {
      this.holds.delete(path);
      object.unexport();
      throw new DBusError(ERRORS.failed, `the desktop could not hold it: ${error instanceof Error ? error.message : String(error)}`);
    }
    // Closed while the shell was answering: let go at once.
    if (entry.closed) await this.deps.shell.uninhibit(entry.id).catch(() => {});
  }

  createMonitor(handle: unknown, sessionHandle: unknown): number {
    handlePath(handle);
    const session = openSession(this.deps.bus, sessionHandle, () => this.sessions.delete(session.path));
    this.sessions.set(session.path, session);
    // After the reply, which is when the app starts listening.
    (this.deps.later ?? ((work) => setTimeout(work, 50)))(() => {
      if (!this.sessions.has(session.path)) return;
      this.deps.stateChanged(
        session.path,
        new Map([
          ["screensaver-active", variant("b", false)],
          ["session-state", variant("u", RUNNING)],
        ]),
      );
    });
    return Response.success;
  }

  spec(): InterfaceSpec {
    return {
      name: INHIBIT,
      methods: {
        Inhibit: {
          in: "ossua{sv}",
          handler: ([handle, appId, , flags, options]) => this.inhibit(handle, String(appId), Number(flags), options),
        },
        CreateMonitor: {
          in: "ooss",
          out: "u",
          handler: ([handle, session]) => this.createMonitor(handle, session),
        },
        QueryEndResponse: { in: "o", handler: () => {} },
      },
      signals: { StateChanged: "oa{sv}" },
      properties: { version: { type: "u", get: () => 3 } },
    };
  }
}
