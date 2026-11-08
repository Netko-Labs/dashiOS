import { expect, test } from "bun:test";
import { AppletsClient, parseAppletMessage, parseAppletShellMessage, parseManifest, type SocketHandlers } from "../src/index.ts";
import { ASUS } from "./fixtures.ts";

const noFiles = (): null => null;
const line = (value: unknown): string => JSON.stringify(value);

test("version 2's messages: hello first, then popovers and dismiss", () => {
  const hello = parseAppletMessage(line({ type: "hello", protocol: 2, manifest: ASUS, dev: true }));
  expect(hello).toMatchObject({ type: "hello", protocol: 2, dev: true, manifest: { id: "dev.netko.asus-control" } });
  expect(parseAppletMessage(line({ type: "hello", protocol: 2, manifest: { ...ASUS, id: "bad" } }))).toHaveProperty("error");
  expect(parseAppletMessage(line({ type: "hello", protocol: 1, manifest: ASUS }))).toHaveProperty("error");
  // Version 1 refuses version 2's messages.
  expect(parseAppletMessage(line({ type: "popover", id: "a", width: 300, height: 200 }))).toMatchObject({ error: expect.stringContaining("hello") });
  expect(parseAppletMessage(line({ type: "popover", id: "a", width: 300, height: 200 }), noFiles, 2)).toEqual({
    type: "popover",
    id: "a",
    width: 300,
    height: 200,
  });
  expect(parseAppletMessage(line({ type: "popover", id: "a", width: 5000, height: 200 }), noFiles, 2)).toHaveProperty("error");
  expect(parseAppletMessage(line({ type: "popover", id: "a", width: 300.5, height: 200 }), noFiles, 2)).toHaveProperty("error");
  expect(parseAppletMessage(line({ type: "dismiss", id: "a" }), noFiles, 2)).toEqual({ type: "dismiss", id: "a" });
});

test("submenus need version 2, and go three levels at most", () => {
  const applet = (menu: unknown) => line({ type: "applet", applet: { id: "w", title: "Weather", label: "21°", menu } });
  const nested = [
    { id: "refresh", label: "Refresh" },
    {
      type: "submenu",
      label: "Units",
      items: [
        { id: "c", label: "Celsius", checked: true },
        { id: "f", label: "Fahrenheit", checked: false },
      ],
    },
  ];
  expect(parseAppletMessage(applet(nested), noFiles, 1)).toMatchObject({ error: expect.stringContaining("protocol 2") });
  const parsed = parseAppletMessage(applet(nested), noFiles, 2);
  expect(parsed).toMatchObject({
    type: "applet",
    applet: {
      menu: [
        { kind: "item", id: "refresh" },
        { kind: "submenu", label: "Units" },
      ],
    },
  });
  const deep = [
    { type: "submenu", label: "1", items: [{ type: "submenu", label: "2", items: [{ type: "submenu", label: "3", items: [{ id: "x", label: "X" }] }] }] },
  ];
  expect(parseAppletMessage(applet(deep), noFiles, 2)).toMatchObject({ error: expect.stringContaining("3 levels") });
  const twice = [
    { id: "a", label: "A" },
    { type: "submenu", label: "S", items: [{ id: "a", label: "A again" }] },
  ];
  expect(parseAppletMessage(applet(twice), noFiles, 2)).toMatchObject({ error: expect.stringContaining("two rows") });
  const many = Array.from({ length: 41 }, (_, at) => ({ id: `r${at}`, label: "Row" }));
  expect(parseAppletMessage(applet(many), noFiles, 2)).toMatchObject({ error: expect.stringContaining("40 rows") });
});

test("the shell's version 2 messages, and newer ones skipped", () => {
  expect(parseAppletShellMessage(line({ type: "welcome", protocol: 2 }))).toEqual({ type: "welcome", protocol: 2 });
  expect(
    parseAppletShellMessage(line({ type: "popover", id: "a", x: 10, y: 32, width: 300, height: 200, output: "eDP-1", namespace: "dashi.applet.x" })),
  ).toEqual({
    type: "popover",
    id: "a",
    x: 10,
    y: 32,
    width: 300,
    height: 200,
    output: "eDP-1",
    namespace: "dashi.applet.x",
  });
  expect(parseAppletShellMessage(line({ type: "dismiss", id: "a" }))).toEqual({ type: "dismiss", id: "a" });
  expect(parseAppletShellMessage(line({ type: "tile", id: "a" }))).toBeNull();
});

function fakeShell() {
  const sent: unknown[] = [];
  let handlers: SocketHandlers | null = null;
  const later: Array<() => void> = [];
  const connect = (_path: string, given: SocketHandlers): void => {
    handlers = given;
    given.open({
      write: (data) => {
        for (const part of new TextDecoder().decode(data).split("\n")) if (part) sent.push(JSON.parse(part));
        return data.byteLength;
      },
      end: () => {},
    });
  };
  const reply = (message: unknown): void => handlers?.data(new TextEncoder().encode(`${JSON.stringify(message)}\n`));
  const drop = (): void => handlers?.close();
  return { sent, connect, reply, drop, later, retry: () => later.shift()?.() };
}

test("the client says hello first, sends each applet whole, and does it all again after the shell restarts", () => {
  const manifest = parseManifest(ASUS);
  if ("error" in manifest) throw new Error(manifest.error);
  const shell = fakeShell();
  const client = new AppletsClient({
    path: "/run/x.sock",
    manifest,
    connect: shell.connect,
    exists: () => true,
    later: (fn) => {
      shell.later.push(fn);
      return () => {};
    },
  });
  const events: string[] = [];
  client.show(
    { id: "asus", title: "ASUS Control", label: "54°" },
    {
      onActivate: () => client.requestPopover("asus", { width: 300, height: 260 }),
      onPopover: (placement) => events.push(`popover ${placement.x},${placement.y} ${placement.namespace}`),
      onDismiss: () => events.push("dismiss"),
    },
  );
  expect(shell.sent[0]).toMatchObject({ type: "hello", protocol: 4, manifest: { permissions: ASUS.permissions } });
  expect(shell.sent[1]).toMatchObject({ type: "applet", applet: { id: "asus", label: "54°" } });
  // The same applet again sends nothing; a change sends it whole.
  client.show({ id: "asus", title: "ASUS Control", label: "54°" });
  expect(shell.sent).toHaveLength(2);
  client.show({ id: "asus", title: "ASUS Control", label: "55°" });
  expect(shell.sent[2]).toMatchObject({ type: "applet", applet: { label: "55°" } });

  shell.reply({ type: "activate", id: "asus", x: 1200, y: 28 });
  expect(shell.sent[3]).toEqual({ type: "popover", id: "asus", width: 300, height: 260 });
  shell.reply({ type: "popover", id: "asus", x: 1050, y: 32, width: 300, height: 260, output: "eDP-1", namespace: "dashi.applet.dev.netko.asus-control" });
  expect(events).toEqual(["popover 1050,32 dashi.applet.dev.netko.asus-control"]);
  shell.reply({ type: "dismiss", id: "asus" });
  expect(events).toEqual(["popover 1050,32 dashi.applet.dev.netko.asus-control", "dismiss"]);

  // The shell goes with a popover open: it is dismissed, and everything is sent again on reconnect.
  shell.reply({ type: "activate", id: "asus", x: 1200, y: 28 });
  shell.drop();
  expect(events.at(-1)).toBe("dismiss");
  shell.sent.length = 0;
  shell.retry();
  expect(shell.sent.map((message) => (message as { type: string }).type)).toEqual(["hello", "applet"]);
});

test("a version 1 client (no manifest) never says hello and can't ask for popovers or submenus", () => {
  const shell = fakeShell();
  const client = new AppletsClient({ path: "/run/x.sock", connect: shell.connect, exists: () => true, later: () => () => {} });
  client.show({ id: "timer", title: "Timer", label: "4:59" });
  expect(shell.sent).toEqual([{ type: "applet", applet: { id: "timer", title: "Timer", label: "4:59" } }]);
  expect(client.requestPopover("timer", { width: 200, height: 100 })).toBe(false);
  expect(client.show({ id: "t2", title: "T", label: "x", menu: [{ type: "submenu", label: "S", items: [{ id: "a", label: "A" }] }] })).toBe(false);
});
