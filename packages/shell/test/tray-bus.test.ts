/**
 * The tray against a real bus: a private dbus-daemon in a temporary directory
 * (its own config, no service activation, nothing of the host's session), a
 * fake app that exports a StatusNotifierItem and a dbusmenu, and the extras
 * store the menu bar reads.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExtrasStore } from "../src/extras/store.ts";
import type { MenuBarExtra } from "../src/extras/types.ts";
import { DBusConnection, getNameOwner, type InterfaceSpec, Variant } from "../src/shared/dbus/index.ts";
import { startTray, type Tray, WATCHER, WATCHER_PATH } from "../src/tray/index.ts";
import { until as eventually, untilValue as until } from "./support/time.ts";

const daemon = Bun.which("dbus-daemon");
const dir = mkdtempSync(join(tmpdir(), "dashi-tray-bus-"));
const socket = join(dir, "bus");
const address = `unix:path=${socket}`;
let bus: Bun.Subprocess | null = null;

beforeAll(async () => {
  if (!daemon) return;
  const config = join(dir, "bus.conf");
  writeFileSync(
    config,
    `<!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-Bus Bus Configuration 1.0//EN" "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">
<busconfig>
  <type>session</type>
  <listen>${address}</listen>
  <auth>EXTERNAL</auth>
  <policy context="default">
    <allow send_destination="*" eavesdrop="true"/>
    <allow eavesdrop="true"/>
    <allow own="*"/>
  </policy>
</busconfig>
`,
  );
  bus = Bun.spawn([daemon, "--config-file", config, "--nofork", "--print-address"], { stdout: "pipe", stderr: "inherit" });
  await until(() => existsSync(socket), "the bus socket");
});

afterAll(() => {
  bus?.kill();
  rmSync(dir, { recursive: true, force: true });
});

/** A fake tray app: one item at /StatusNotifierItem with a menu at /MenuBar. */
async function fakeApp() {
  const connection = await DBusConnection.connect({ address });
  const state = { status: "Active", title: "Fake App", activated: [] as number[][], events: [] as [number, string][] };
  const side = 32;
  const argb = new Uint8Array(side * side * 4).map((_, i) => (i % 4 === 0 ? 0xff : i & 0xff));
  const item: InterfaceSpec = {
    name: "org.kde.StatusNotifierItem",
    methods: {
      Activate: { in: "ii", handler: ([x, y]) => void state.activated.push([x as number, y as number]) },
      SecondaryActivate: { in: "ii", handler: () => {} },
    },
    signals: { NewStatus: "s", NewTitle: "" },
    properties: {
      Id: { type: "s", get: () => "fake-app" },
      Title: { type: "s", get: () => state.title },
      Status: { type: "s", get: () => state.status },
      IconName: { type: "s", get: () => "" },
      IconPixmap: { type: "a(iiay)", get: () => [[side, side, argb]] },
      ToolTip: { type: "(sa(iiay)ss)", get: () => ["", [], "Fake App", "All good"] },
      ItemIsMenu: { type: "b", get: () => false },
      Menu: { type: "o", get: () => "/MenuBar" },
    },
  };
  const node = (id: number, props: Record<string, Variant>, children: unknown[] = []) => [
    id,
    new Map(Object.entries(props)),
    children.map((child) => new Variant("(ia{sv}av)", child)),
  ];
  const menu: InterfaceSpec = {
    name: "com.canonical.dbusmenu",
    methods: {
      AboutToShow: { in: "i", out: "b", handler: () => false },
      GetLayout: {
        in: "iias",
        out: "u(ia{sv}av)",
        handler: () => [
          1,
          node(0, { "children-display": new Variant("s", "submenu") }, [
            node(1, { label: new Variant("s", "_Show") }),
            node(2, { type: new Variant("s", "separator") }),
            node(3, { label: new Variant("s", "_Quit") }),
          ]),
        ],
      },
      Event: { in: "isvu", handler: ([id, event]) => void state.events.push([id as number, event as string]) },
    },
  };
  const object = connection.export("/StatusNotifierItem", [item]);
  connection.export("/MenuBar", [menu]);
  return { connection, state, object, key: `tray:${connection.uniqueName}/StatusNotifierItem` };
}

const register = (connection: DBusConnection, arg: string) =>
  connection.call({ destination: WATCHER, path: WATCHER_PATH, interface: WATCHER, member: "RegisterStatusNotifierItem", signature: "s", body: [arg] });

const registered = async (connection: DBusConnection): Promise<unknown> => {
  const [value] = await connection.call({
    destination: WATCHER,
    path: WATCHER_PATH,
    interface: "org.freedesktop.DBus.Properties",
    member: "Get",
    signature: "ss",
    body: [WATCHER, "RegisteredStatusNotifierItems"],
  });
  return value instanceof Variant ? value.value : value;
};

describe.skipIf(!daemon)("the tray on a private bus", () => {
  let tray: Tray | null = null;
  const extras = new ExtrasStore();
  const find = (key: string): MenuBarExtra | undefined => extras.getSnapshot().find((extra) => extra.key === key);

  afterAll(() => tray?.close());

  test("serves the watcher and shows a registered item, its menu, and its clicks", async () => {
    tray = await startTray(extras, { bus: { address }, icons: { roots: [], cacheDir: join(dir, "icons") } });
    expect(tray).not.toBeNull();
    const app = await fakeApp();
    expect(await getNameOwner(app.connection, `org.kde.StatusNotifierHost-${process.pid}`)).toBeTruthy();
    await register(app.connection, "/StatusNotifierItem");
    expect(await registered(app.connection)).toEqual([`${app.connection.uniqueName}/StatusNotifierItem`]);

    const extra = await until(() => find(app.key), "the item's extra");
    expect(extra).toMatchObject({ source: "tray", title: "Fake App", tooltip: "Fake App\nAll good", attention: false, hasMenu: true, menuOnClick: false });
    expect(extra.icon?.kind).toBe("image");
    const iconPath = extra.icon?.kind === "image" ? extra.icon.path : "";
    expect([...readFileSync(iconPath).subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);

    expect(await extras.menu(app.key)).toEqual([
      { kind: "item", id: "1", label: "Show", enabled: true },
      { kind: "separator" },
      { kind: "item", id: "3", label: "Quit", enabled: true },
    ]);
    extras.choose(app.key, "3");
    extras.menuClosed(app.key);
    extras.activate(app.key, 120.6, 4);
    await until(() => app.state.events.length >= 3 && app.state.activated.length > 0, "the app to hear the clicks");
    expect(app.state.events).toEqual([
      [0, "opened"],
      [3, "clicked"],
      [0, "closed"],
    ]);
    expect(app.state.activated).toEqual([[121, 4]]);

    // Passive hides it; Active again brings it back, re-read on the signal.
    app.state.status = "Passive";
    app.object.emit("org.kde.StatusNotifierItem", "NewStatus", "Passive");
    await until(() => !find(app.key), "the passive item to go");
    app.state.status = "NeedsAttention";
    app.state.title = "Fake App!";
    app.object.emit("org.kde.StatusNotifierItem", "NewStatus", "NeedsAttention");
    expect(await until(() => find(app.key), "the item to come back")).toMatchObject({ attention: true, title: "Fake App!" });

    // The app leaves the bus: its item and its icon file go.
    app.connection.close();
    await until(() => !find(app.key), "the item of an app that left to go");
    await until(() => !existsSync(iconPath), "the icon file to go");
    const observer = await DBusConnection.connect({ address });
    expect(await registered(observer)).toEqual([]);
    observer.close();
  });

  test("a second tray follows the first one's watcher, and takes it over when it goes", async () => {
    const second = new ExtrasStore();
    const follower = await startTray(second, { bus: { address }, icons: { roots: [], cacheDir: join(dir, "icons-2") } });
    expect(follower).not.toBeNull();
    const app = await fakeApp();
    await register(app.connection, app.connection.uniqueName);
    await until(() => second.getSnapshot().some((extra) => extra.key === app.key), "the follower to show the item");
    await until(() => find(app.key), "the watcher's own host to show the item");

    tray?.close();
    tray = null;
    await until(() => second.getSnapshot().length === 0, "the follower to drop the old watcher's items");
    // The app registers again with the new watcher, as apps do when the watcher appears.
    await eventually(
      () =>
        register(app.connection, "/StatusNotifierItem").then(
          () => true,
          () => false,
        ),
      "a new watcher to answer",
    );
    await until(() => second.getSnapshot().some((extra) => extra.key === app.key), "the new watcher's host to show the item");
    app.connection.close();
    follower?.close();
  });
});
