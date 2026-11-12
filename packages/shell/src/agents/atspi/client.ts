/**
 * AT-SPI over D-Bus: the accessibility bus (its address from org.a11y.Bus),
 * turned on for toolkits (org.a11y.Status.IsEnabled, which makes GTK, Qt,
 * Firefox and Chromium publish their trees), and an app's tree found by the
 * process that owns it. tree.ts walks what this returns.
 */

import { DBusConnection, unwrap, variant } from "../../shared/dbus/index.ts";
import { type A11yNode, documents, limits, type Rect } from "./tree.ts";

const PROPERTIES = "org.freedesktop.DBus.Properties";
const ACCESSIBLE = "org.a11y.atspi.Accessible";
/** Each call's budget: a hung app must not hold an agent's screenshot. */
const CALL_MS = 300;
/** ATSPI_COORD_TYPE_WINDOW. */
const WINDOW_COORDS = 1;
/** How long a woken app takes to publish its views (Chromium: measured well under this in the VM). */
const WAKE_MS = 400;

function rectOf(value: unknown): Rect | null {
  if (!Array.isArray(value) || value.length !== 4 || !value.every((n): n is number => typeof n === "number" && Number.isFinite(n))) return null;
  const [x, y, width, height] = value;
  return width && height && width > 0 && height > 0 ? { x: x ?? 0, y: y ?? 0, width, height } : null;
}

class Node implements A11yNode {
  constructor(
    private readonly bus: DBusConnection,
    readonly name: string,
    readonly path: string,
  ) {}

  /** Which object it is on the bus. */
  get key(): string {
    return `${this.name}${this.path}`;
  }

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
      const [name, path]: unknown[] = child;
      return typeof name === "string" && typeof path === "string" && path !== "/org/a11y/atspi/null" ? [new Node(this.bus, name, path)] : [];
    });
  }

  async extents(): Promise<Rect | null> {
    return rectOf(await this.call("org.a11y.atspi.Component", "GetExtents", "u", [WINDOW_COORDS]));
  }

  async parent(): Promise<A11yNode | null> {
    const value = unwrap(await this.call(PROPERTIES, "Get", "ss", [ACCESSIBLE, "Parent"]));
    if (!Array.isArray(value)) return null;
    const [name, path]: unknown[] = value;
    return typeof name === "string" && typeof path === "string" && path !== "/org/a11y/atspi/null" ? new Node(this.bus, name, path) : null;
  }

  /** Its attributes, asked only for the asking's sake (see Atspi.wake). */
  async attributes(): Promise<void> {
    await this.call(ACCESSIBLE, "GetAttributes");
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
  /** What last took the focus in each app (by its bus name), from focus events. */
  private readonly focus = new Map<string, string>();
  /** Apps asked to publish their whole tree already (wake). */
  private readonly woken = new Set<string>();

  private constructor(private readonly bus: DBusConnection) {}

  /** Follow focus events: apps send them once someone has registered for them. */
  private async watchFocus(): Promise<void> {
    const registry = {
      destination: "org.a11y.atspi.Registry",
      path: "/org/a11y/atspi/registry",
      interface: "org.a11y.atspi.Registry",
      member: "RegisterEvent",
    };
    const event = "object:state-changed:focused";
    // Newer at-spi2 takes the properties to send along and an app; older, the event alone.
    await this.bus
      .call({ ...registry, signature: "sass", body: [event, [], ""] }, 1000)
      .catch(() => this.bus.call({ ...registry, signature: "s", body: [event] }, 1000).catch(() => {}));
    await this.bus.subscribe({ type: "signal", interface: "org.a11y.atspi.Event.Object", member: "StateChanged" }, (message) => {
      const [detail, gained] = message.body;
      if (detail !== "focused" || gained !== 1 || typeof message.sender !== "string" || typeof message.path !== "string") return;
      this.focus.set(message.sender, message.path);
    });
  }

  /** The node that last took the focus in the app that runs as `pid`, if one did. */
  async focusedIn(pid: number): Promise<A11yNode | null> {
    for (const [name, path] of this.focus) {
      if ((await this.pidOf(name)) === pid) return new Node(this.bus, name, path);
    }
    return null;
  }

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
      const atspi = new Atspi(await DBusConnection.connect({ address, timeoutMs: 2000 }));
      await atspi.watchFocus().catch(() => {});
      return atspi;
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
    const raw = unwrap(pid);
    const value = typeof raw === "number" ? raw : null;
    this.pids.set(name, value);
    return value;
  }

  /**
   * Chromium (Chrome, Helium, Electron) publishes only its windows until an
   * assistive technology asks a node for its attributes, as Orca does
   * (AtkGetAttributes turns its web tree on: ax_platform_node_auralinux.cc);
   * IsEnabled and ScreenReaderEnabled alone don't. So ask, once per app: true
   * when this woke it now (its tree is built in a moment), false when it was
   * awake already or has no tree to give.
   */
  async wake(pid: number, again = false): Promise<boolean> {
    const app = await this.appFor(pid);
    if (!(app instanceof Node) || (this.woken.has(app.name) && !again)) return false;
    this.woken.add(app.name);
    const ask = (nodes: readonly A11yNode[]) => Promise.all(nodes.map((node) => (node instanceof Node ? node.attributes().catch(() => {}) : undefined)));
    // The windows first: that publishes the browser's own views, among them
    // each tab's document, still empty; asked in turn, the documents fill in.
    await ask([app, ...(await app.children().catch(() => []))]);
    await Bun.sleep(WAKE_MS);
    await ask(await documents(app, limits(1000, 4000)));
    return true;
  }

  /** Every app on the bus, with the process that serves it. */
  async apps(): Promise<Array<{ pid: number | null; app: A11yNode }>> {
    const root = new Node(this.bus, "org.a11y.atspi.Registry", "/org/a11y/atspi/accessible/root");
    const apps = await root.children().catch(() => []);
    return Promise.all(apps.map(async (app) => ({ pid: app instanceof Node ? await this.pidOf(app.name) : null, app })));
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
