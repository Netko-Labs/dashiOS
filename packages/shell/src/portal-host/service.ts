/**
 * The shell's side of the portal (protocol.ts) and org.freedesktop.ScreenSaver,
 * on one session-bus connection: holds (inhibit/), sheets (sheets.ts), and
 * web apps for the Dock (launchers.ts). Whoever leaves the bus lets go of
 * what it held, so an app (or a portal) that dies stops keeping the
 * computer awake. Without a session bus, it says so and the shell goes on.
 */

import { BUS_NAME, type ConnectOptions, DBusConnection, DBusError, ERRORS, getNameOwner, type InterfaceSpec, NameFlags, requestName } from "../dbus/index.ts";
import { type InhibitStore, SCREENSAVER, SCREENSAVER_PATHS, type ScreenSaverHost, screenSaverInterface } from "../inhibit/index.ts";
import { PORTAL_BACKEND, PORTAL_HOST, SHELL_NAME, SHELL_PATH } from "./protocol.ts";

export interface PortalHostDeps {
  store: InhibitStore;
  screenSaver: Omit<ScreenSaverHost, "store">;
  /** A portal dialog titled `title` is coming for `parent`; false when the handle is not one. */
  expectSheet(title: string, parent: string): boolean;
  /** Pin the launcher `appId` installs next. */
  addToDock(appId: string, name: string): void;
}

export interface PortalHost {
  /** Tell ScreenSaver callers the lock screen came or went. */
  lockChanged(locked: boolean): void;
  close(): void;
}

export function portalHostInterface(deps: PortalHostDeps, isPortal: (sender: string | undefined) => Promise<boolean>): InterfaceSpec {
  const fromPortal = async (sender: string | undefined) => {
    if (!(await isPortal(sender))) throw new DBusError(ERRORS.accessDenied, "only dashi-portal may ask that");
  };
  return {
    name: PORTAL_HOST,
    methods: {
      Inhibit: {
        in: "ssu",
        out: "u",
        handler: ([appId, reason, flags], call) => {
          if (!call.sender) throw new DBusError(ERRORS.accessDenied, "no caller");
          const id = deps.store.add({ owner: call.sender, appId: String(appId), reason: String(reason), flags: Number(flags), via: "portal" });
          if (id === null) throw new DBusError(ERRORS.limitsExceeded, "too many holds from one caller");
          return id;
        },
      },
      Uninhibit: {
        in: "u",
        handler: ([id], call) => {
          if (call.sender) deps.store.release(Number(id), call.sender);
        },
      },
      ExpectSheet: {
        in: "ss",
        out: "b",
        handler: async ([title, parent], call) => {
          await fromPortal(call.sender);
          return deps.expectSheet(String(title), String(parent));
        },
      },
      AddToDock: {
        in: "ss",
        handler: async ([appId, name], call) => {
          await fromPortal(call.sender);
          deps.addToDock(String(appId), String(name));
        },
      },
    },
  };
}

export async function startPortalHost(deps: PortalHostDeps, options: ConnectOptions = {}): Promise<PortalHost | null> {
  let connection: DBusConnection;
  try {
    connection = await DBusConnection.connect(options);
  } catch (error) {
    console.error("dashi-shell: no keep-awake or portal host, no session bus:", error instanceof Error ? error.message : error);
    return null;
  }
  const isPortal = async (sender: string | undefined) => sender !== undefined && (await getNameOwner(connection, PORTAL_BACKEND).catch(() => null)) === sender;
  connection.export(SHELL_PATH, [portalHostInterface(deps, isPortal)]);
  const screenSaver = screenSaverInterface({ ...deps.screenSaver, store: deps.store });
  const exported = SCREENSAVER_PATHS.map((path) => connection.export(path, [screenSaver]));
  // Whoever leaves the bus lets go: an app that crashed mid-video, or the portal.
  await connection
    .subscribe({ type: "signal", sender: BUS_NAME, interface: BUS_NAME, member: "NameOwnerChanged" }, (message) => {
      const [name, , owner] = message.body;
      if (typeof name === "string" && name.startsWith(":") && owner === "") deps.store.releaseOwner(name);
    })
    .catch((error) => console.error("dashi-shell: holds will outlive the apps that die:", error instanceof Error ? error.message : error));
  for (const name of [SHELL_NAME, SCREENSAVER]) {
    const result = await requestName(connection, name, NameFlags.doNotQueue).catch(() => "exists" as const);
    if (result !== "primary" && result !== "already-owner") console.error(`dashi-shell: ${name} is owned by another program; it keeps it`);
  }
  connection.onClose((error) => {
    if (error) console.error("dashi-shell: the portal host lost its bus connection:", error.message);
  });
  return {
    lockChanged(locked) {
      if (connection.closed) return;
      for (const object of exported) object.emit(SCREENSAVER, "ActiveChanged", locked);
    },
    close: () => connection.close(),
  };
}
