import { expect, test } from "bun:test";
import { parseManifest } from "@dashi/applet";
import { AppletConnection } from "../src/applets/lib/connection.ts";
import type { AppletContext } from "../src/applets/lib/connection-context.ts";
import { AppletGrants } from "../src/applets/lib/grants.ts";
import { EDGE_MARGIN, placePopover } from "../src/applets/lib/placement.ts";
import { flattenRows } from "../src/applets/lib/protocol.ts";
import { AppletPopovers } from "../src/applets/popovers.ts";
import { ExtrasStore } from "../src/extras/index.ts";
import { settle } from "./support/time.ts";

const MANIFEST = {
  id: "dev.example.weather",
  name: "Weather",
  version: "0.1.0",
  dashi: ">=0.4",
  entry: "src/main.tsx",
  summary: "The weather where you are.",
  author: { name: "Alex Kim" },
  permissions: ["network"],
};

const SCREEN = { name: "eDP-1", width: 1440, height: 900, barHeight: 28 };

function harness(extra: Partial<AppletContext> = {}) {
  const written: Array<Record<string, unknown>> = [];
  let terminated = false;
  const extras = new ExtrasStore();
  const requests: unknown[] = [];
  const grants = new AppletGrants({
    appletClients: async (params) => {
      requests.push(params);
      return {};
    },
  });
  const outside: Array<() => void> = [];
  const catchers = { open: 0, closed: 0 };
  const context: AppletContext = {
    extras,
    grants,
    screen: () => SCREEN,
    catcher: (_placement, onOutside) => {
      catchers.open++;
      outside.push(onOutside);
      return () => catchers.closed++;
    },
    ...extra,
  };
  const wire = {
    write: (data: Uint8Array) => {
      for (const line of new TextDecoder().decode(data).split("\n")) if (line) written.push(JSON.parse(line));
      return data.byteLength;
    },
    terminate: () => {
      terminated = true;
    },
  };
  const conn = new AppletConnection(4242, wire, context);
  const send = (message: unknown) => conn.receive(new TextEncoder().encode(`${JSON.stringify(message)}\n`));
  return { conn, extras, written, send, requests, grants, outside, catchers, settle, terminated: () => terminated };
}

test("version 1 applets are as they were: no welcome, no grants, popovers refused", () => {
  const { send, written, requests, extras } = harness();
  send({ type: "applet", applet: { id: "w", title: "Weather", label: "21°" } });
  expect(extras.getSnapshot()).toHaveLength(1);
  send({ type: "popover", id: "w", width: 300, height: 200 });
  expect(written).toEqual([{ type: "error", message: expect.stringContaining("hello") }]);
  expect(requests).toEqual([]);
});

test("hello: welcome, the process registered for grants, and a dev applet badged", async () => {
  const { send, written, requests, extras, settle } = harness();
  send({ type: "hello", protocol: 2, manifest: MANIFEST, dev: true });
  send({ type: "applet", applet: { id: "w", title: "Weather", label: "21°" } });
  await settle();
  expect(written[0]).toEqual({ type: "welcome", protocol: 2 });
  expect(requests).toEqual([{ applets: [{ pid: 4242, layerShell: false }] }]);
  expect(extras.getSnapshot()[0]).toMatchObject({ dev: true, label: "21°" });
  // Once, and first.
  send({ type: "hello", protocol: 2, manifest: MANIFEST });
  expect(written.at(-1)).toMatchObject({ type: "error", message: expect.stringContaining("first, once") });
});

test("a sandboxed applet must say hello as what it was installed as", () => {
  const installed = parseManifest(MANIFEST);
  if ("error" in installed) throw new Error(installed.error);
  const quiet = harness({ installed });
  quiet.send({ type: "applet", applet: { id: "w", title: "Weather", label: "21°" } });
  expect(quiet.terminated()).toBe(true);
  expect(quiet.extras.getSnapshot()).toHaveLength(0);

  const greedy = harness({ installed });
  greedy.send({ type: "hello", protocol: 2, manifest: { ...MANIFEST, permissions: ["network", "files.documents"] } });
  expect(greedy.terminated()).toBe(true);
  expect(greedy.written[0]).toMatchObject({ type: "error", message: expect.stringContaining("not dev.example.weather 0.1.0 as installed") });

  const honest = harness({ installed });
  honest.send({ type: "hello", protocol: 2, manifest: MANIFEST, dev: true });
  honest.send({ type: "applet", applet: { id: "w", title: "Weather", label: "21°" } });
  expect(honest.terminated()).toBe(false);
  // Never badged "dev" in the sandbox.
  expect(honest.extras.getSnapshot()[0]?.dev).toBeUndefined();
});

test("a popover: placed under the click, granted before the applet hears where, closed by a click outside or the item again", async () => {
  const h = harness();
  h.send({ type: "hello", protocol: 2, manifest: MANIFEST });
  h.send({ type: "applet", applet: { id: "w", title: "Weather", label: "21°", click: "activate" } });
  const key = h.extras.getSnapshot()[0]?.key ?? "";
  h.extras.activate(key, 1200, 28, "eDP-1");
  expect(h.written.at(-1)).toEqual({ type: "activate", id: "w", x: 1200, y: 28 });
  h.send({ type: "popover", id: "w", width: 280, height: 190 });
  await h.settle();
  expect(h.requests.at(-1)).toEqual({ applets: [{ pid: 4242, layerShell: true }] });
  expect(h.written.at(-1)).toEqual({
    type: "popover",
    id: "w",
    x: 1060,
    y: 32,
    width: 280,
    height: 190,
    output: "eDP-1",
    namespace: "dashi.applet.dev.example.weather",
  });
  expect(h.catchers.open).toBe(1);

  // A click outside: the shell dismisses, the grant goes.
  h.outside[0]?.();
  await h.settle();
  expect(h.written.at(-1)).toEqual({ type: "dismiss", id: "w" });
  expect(h.requests.at(-1)).toEqual({ applets: [{ pid: 4242, layerShell: false }] });
  expect(h.catchers.closed).toBe(1);

  // Open again; the item clicked again dismisses instead of activating.
  h.send({ type: "popover", id: "w", width: 280, height: 190 });
  await h.settle();
  h.extras.activate(key, 1200, 28, "eDP-1");
  expect(h.written.at(-1)).toEqual({ type: "dismiss", id: "w" });

  // The applet closes its own: no dismiss back, the grant goes.
  h.send({ type: "popover", id: "w", width: 280, height: 190 });
  await h.settle();
  const before = h.written.length;
  h.send({ type: "dismiss", id: "w" });
  await h.settle();
  expect(h.written.length).toBe(before);
  expect(h.grants.granted(4242)).toBe(false);

  // The connection closes with one open: the grant and the process go.
  h.send({ type: "popover", id: "w", width: 280, height: 190 });
  await h.settle();
  h.conn.closedBySocket();
  await h.settle();
  expect(h.requests.at(-1)).toEqual({ applets: [] });
});

test("one popover at a time: another applet's, or a shell menu, closes the open one, as the shell's menus do", async () => {
  const popovers = new AppletPopovers();
  let shellMenusClosed = 0;
  popovers.closeShellMenusWith(() => shellMenusClosed++);
  const open = async (h: ReturnType<typeof harness>, id: string) => {
    h.send({ type: "hello", protocol: 2, manifest: { ...MANIFEST, id: `dev.example.${id}` } });
    h.send({ type: "applet", applet: { id, title: id, label: id, click: "activate" } });
    h.send({ type: "popover", id, width: 280, height: 190 });
    await h.settle();
  };
  const weather = harness({ popovers });
  const timer = harness({ popovers });

  // Weather's opens: the shell's menu (if one was open) closes.
  await open(weather, "weather");
  expect(weather.written.at(-1)).toMatchObject({ type: "popover", id: "weather" });
  expect(shellMenusClosed).toBe(1);
  expect(popovers.isOpen()).toBe(true);

  // The timer's opens: weather's is dismissed, its grant and its sheet go.
  await open(timer, "timer");
  expect(timer.written.at(-1)).toMatchObject({ type: "popover", id: "timer" });
  expect(weather.written.at(-1)).toEqual({ type: "dismiss", id: "weather" });
  expect(weather.grants.granted(4242)).toBe(false);
  expect(weather.catchers.closed).toBe(1);
  expect(shellMenusClosed).toBe(2);

  // A shell menu opens (Control Center, an app's menu): the timer's goes too.
  popovers.dismiss();
  await timer.settle();
  expect(timer.written.at(-1)).toEqual({ type: "dismiss", id: "timer" });
  expect(timer.catchers.closed).toBe(1);
  expect(popovers.isOpen()).toBe(false);

  // One the applet closes itself (Esc in it) is no longer the open one: a shell menu then dismisses nothing.
  const clock = harness({ popovers });
  await open(clock, "clock");
  clock.send({ type: "dismiss", id: "clock" });
  expect(popovers.isOpen()).toBe(false);
  const said = clock.written.length;
  popovers.dismiss();
  expect(clock.written.length).toBe(said);
});

test("popover placement at each screen edge", () => {
  const size = { width: 300, height: 260 };
  // Under the item, centered.
  expect(placePopover(size, 700, SCREEN)).toEqual({ x: 550, y: 32, width: 300, height: 260, output: "eDP-1" });
  // An item at the left edge: kept inside.
  expect(placePopover(size, 20, SCREEN).x).toBe(EDGE_MARGIN);
  // At the right edge.
  expect(placePopover(size, 1435, SCREEN).x).toBe(1440 - EDGE_MARGIN - 300);
  // No click known: at the right, under the status area.
  expect(placePopover(size, null, SCREEN).x).toBe(1440 - EDGE_MARGIN - 300);
  // Taller than the screen below the bar: the room there is.
  expect(placePopover({ width: 300, height: 900 }, 700, SCREEN)).toMatchObject({ y: 32, height: 900 - 32 - EDGE_MARGIN });
  // Wider than a small screen: the screen's width, less the margins.
  expect(placePopover({ width: 700, height: 200 }, 300, { ...SCREEN, width: 640 })).toMatchObject({ x: EDGE_MARGIN, width: 640 - 2 * EDGE_MARGIN });
  // A taller bar (a bigger text size) moves it down.
  expect(placePopover(size, 700, { ...SCREEN, barHeight: 36 }).y).toBe(40);
});

test("submenus show as headings with their rows indented, as a tray item's", () => {
  const rows = flattenRows([
    { kind: "item", id: "refresh", label: "Refresh", enabled: true },
    { kind: "separator" },
    {
      kind: "submenu",
      label: "Units",
      enabled: false,
      rows: [{ kind: "item", id: "c", label: "Celsius", enabled: true, checked: true }],
    },
  ]);
  expect(rows).toEqual([
    { kind: "item", id: "refresh", label: "Refresh", enabled: true },
    { kind: "separator" },
    { kind: "item", id: "submenu:0", label: "Units", enabled: false, heading: true },
    { kind: "item", id: "c", label: "Celsius", enabled: false, checked: true, depth: 1 },
  ]);
});

test("a chosen row of a submenu goes back; a heading or a disabled row doesn't", () => {
  const h = harness();
  h.send({ type: "hello", protocol: 2, manifest: MANIFEST });
  h.send({
    type: "applet",
    applet: {
      id: "w",
      title: "Weather",
      label: "21°",
      menu: [
        {
          type: "submenu",
          label: "Units",
          items: [
            { id: "c", label: "Celsius" },
            { id: "k", label: "Kelvin", enabled: false },
          ],
        },
      ],
    },
  });
  const key = h.extras.getSnapshot()[0]?.key ?? "";
  h.extras.choose(key, "c");
  h.extras.choose(key, "k");
  h.extras.choose(key, "submenu:0");
  expect(h.written.filter((message) => message.type === "select")).toEqual([{ type: "select", id: "w", item: "c" }]);
});
