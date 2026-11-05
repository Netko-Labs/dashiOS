/**
 * AT-SPI over D-Bus: the accessibility bus (its address from org.a11y.Bus),
 * turned on for toolkits (org.a11y.Status.IsEnabled, which makes GTK, Qt,
 * Firefox and Chromium publish their trees), and an app's tree found by the
 * process that owns it. tree.ts walks what this returns.
 */

import { DBusConnection } from "../../dbus/index.ts";
import { unwrap } from "../../dbus/properties.ts";
import { variant } from "../../dbus/variant.ts";
import type { A11yNode, Rect } from "./tree.ts";

const PROPERTIES = "org.freedesktop.DBus.Properties";
const ACCESSIBLE = "org.a11y.atspi.Accessible";
/** Each call's budget: a hung app must not hold an agent's screenshot. */
const CALL_MS = 300;
/** ATSPI_COORD_TYPE_WINDOW. */
const WINDOW_COORDS = 1;

function rectOf(value: unknown): Rect | null {
  if (!Array.isArray(value) || value.length !== 4 || !value.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  const [x, y, width, height] = value as number[];
  return width && height && width > 0 && height > 0 ? { x: x ?? 0, y: y ?? 0, width, height } : null;
}

class Node implements A11yNode {
  constructor(
    private readonly bus: DBusConnection,
    readonly name: string,
    readonly path: string,
  ) {}

  private async call(iface: string, member: string, signature?: string, body?: unknown[]): Promise<unknown> {
    const [value] = await this.bus.call(
      { destination: this.name, path: this.path, interface: iface, member, ...(signature ? { signature, body } : {}) },
      CALL_MS,
    );
    return value;
  }

  async role(): Promise<number> {
    const role = await this.call(ACCESSIBLE, "GetRole");
    return typeof role === "number" ? role : -1;
  }

  async states(): Promise<readonly number[]> {
    const states = await this.call(ACCESSIBLE, "GetState");
    return Array.isArray(states) ? states.filter((n): n is number => typeof n === "number") : [];
  }

  async children(): Promise<A11yNode[]> {
    const children = await this.call(ACCESSIBLE, "GetChildren");
    if (!Array.isArray(children)) return [];
    return children.flatMap((child: unknown) => {
      if (!Array.isArray(child)) return [];
      const [name, path] = child as unknown[];
      return typeof name === "string" && typeof path === "string" && path !== "/org/a11y/atspi/null" ? [new Node(this.bus, name, path)] : [];
    });
  }

  async extents(): Promise<Rect | null> {
    return rectOf(await this.call("org.a11y.atspi.Component", "GetExtents", "u", [WINDOW_COORDS]));
  }

  async url(): Promise<string | null> {
    for (const name of ["DocURL", "URI"]) {
      const value = await this.call("org.a11y.atspi.Document", "GetAttributeValue", "s", [name]).catch(() => null);
      if (typeof value === "string" && value !== "") return value;
    }
    return null;
  }
}

export class Atspi {
  private readonly pids = new Map<string, number | null>();

  private constructor(private readonly bus: DBusConnection) {}

  /** Turn accessibility on and join its bus; null where there is none. */
  static async connect(): Promise<Atspi | null> {
    let session: DBusConnection | null = null;
    try {
      session = await DBusConnection.connect({ bus: "session", timeoutMs: 2000 });
      const target = { destination: "org.a11y.Bus", path: "/org/a11y/bus" };
      await session
        .call({ ...target, interface: PROPERTIES, member: "Set", signature: "ssv", body: ["org.a11y.Status", "IsEnabled", variant("b", true)] }, 1000)
        .catch(() => {});
      const [address] = await session.call({ ...target, interface: "org.a11y.Bus", member: "GetAddress" }, 1000);
      if (typeof address !== "string") return null;
      return new Atspi(await DBusConnection.connect({ address, timeoutMs: 2000 }));
    } catch {
      return null;
    } finally {
      session?.close();
    }
  }

  private async pidOf(name: string): Promise<number | null> {
    if (this.pids.has(name)) return this.pids.get(name) ?? null;
    const [pid] = await this.bus
      .call(
        {
          destination: "org.freedesktop.DBus",
          path: "/org/freedesktop/DBus",
          interface: "org.freedesktop.DBus",
          member: "GetConnectionUnixProcessID",
          signature: "s",
          body: [name],
        },
        CALL_MS,
      )
      .catch(() => [null]);
    const value = typeof unwrap(pid) === "number" ? (pid as number) : null;
    this.pids.set(name, value);
    return value;
  }

  /** The tree of the app that runs as `pid` (the window's process). */
  async appFor(pid: number): Promise<A11yNode | null> {
    const root = new Node(this.bus, "org.a11y.atspi.Registry", "/org/a11y/atspi/accessible/root");
    const apps = await root.children().catch(() => []);
    for (const app of apps) {
      if (app instanceof Node && (await this.pidOf(app.name)) === pid) return app;
    }
    return null;
  }

  close(): void {
    this.bus.close();
  }
}
