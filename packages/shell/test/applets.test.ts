import { expect, test } from "bun:test";
import { parseApplet, parseAppletMessage, parseAppletShellMessage } from "@dashi/applet";
import { AppletConnection } from "../src/applets/lib/connection.ts";
import { appletExtra } from "../src/applets/lib/extra.ts";
import { ExtrasStore } from "../src/extras/index.ts";

const GLYPH = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="#000"/></svg>';
const noFiles = (): null => null;
const aFile = (): { file: boolean; size: number } => ({ file: true, size: 100 });

test("an applet with a glyph, a label, and a menu opens its menu on a click by default", () => {
  const applet = parseApplet({ id: "weather", title: "Weather", glyph: GLYPH, label: "21°", menu: [{ id: "refresh", label: "Refresh" }] }, noFiles);
  expect("error" in applet).toBe(false);
  if ("error" in applet) return;
  expect(applet.click).toBe("menu");
  const extra = appletExtra("applet:1/weather", applet);
  expect(extra).toMatchObject({ source: "applet", title: "Weather", label: "21°", menuOnClick: true, hasMenu: true, icon: { kind: "glyph" } });
});

test("an applet without a menu activates on a click", () => {
  const applet = parseApplet({ id: "timer", title: "Timer", label: "4:59" }, noFiles);
  expect(applet).toMatchObject({ click: "activate", menu: [] });
});

test("refusals: nothing to show, both pictures, a glyph that reaches out, a bad icon, a menu click with no menu", () => {
  expect(parseApplet({ id: "a", title: "A" }, noFiles)).toMatchObject({ error: expect.stringContaining("shows nothing") });
  expect(parseApplet({ id: "a", title: "A", glyph: GLYPH, icon: "/x.png" }, aFile)).toMatchObject({ error: expect.stringContaining("not both") });
  for (const bad of [
    '<svg><image href="file:///etc/passwd"/></svg>',
    '<svg><use href="#x"/></svg>',
    "<svg><style>*{}</style></svg>",
    '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg>&x;</svg>',
    '<svg><rect fill="url(http://x)"/></svg>',
    "<div></div>",
  ]) {
    expect(parseApplet({ id: "a", title: "A", glyph: bad }, noFiles)).toHaveProperty("error");
  }
  expect(parseApplet({ id: "a", title: "A", icon: "relative.png" }, aFile)).toMatchObject({ error: expect.stringContaining("absolute") });
  expect(parseApplet({ id: "a", title: "A", icon: "/x.gif" }, aFile)).toMatchObject({ error: expect.stringContaining(".png or .svg") });
  expect(parseApplet({ id: "a", title: "A", icon: "/missing.png" }, noFiles)).toMatchObject({ error: expect.stringContaining("not a file") });
  expect(parseApplet({ id: "a", title: "A", label: "x", click: "menu" }, noFiles)).toMatchObject({ error: expect.stringContaining("no menu") });
  expect(parseApplet({ id: "a", title: "A", label: "x", extra: 1 }, noFiles)).toMatchObject({ error: expect.stringContaining("unknown field") });
  expect(parseApplet({ id: "a", title: "A", label: "x".repeat(25) }, noFiles)).toHaveProperty("error");
});

test("messages from an applet and from the shell", () => {
  expect(parseAppletMessage('{"type":"remove","id":"weather"}')).toEqual({ type: "remove", id: "weather" });
  expect(parseAppletMessage("nope")).toEqual({ error: "not JSON" });
  expect(parseAppletMessage('{"type":"other"}')).toHaveProperty("error");
  expect(parseAppletShellMessage('{"type":"activate","id":"w","x":10,"y":24}')).toEqual({ type: "activate", id: "w", x: 10, y: 24 });
  expect(parseAppletShellMessage('{"type":"select","id":"w","item":"refresh"}')).toEqual({ type: "select", id: "w", item: "refresh" });
  expect(parseAppletShellMessage('{"type":"error","message":"no"}')).toEqual({ type: "error", message: "no" });
});

function connection() {
  const written: string[] = [];
  let terminated = false;
  const extras = new ExtrasStore();
  const wire = {
    write: (data: Uint8Array) => {
      written.push(new TextDecoder().decode(data));
      return data.byteLength;
    },
    terminate: () => {
      terminated = true;
    },
  };
  const conn = new AppletConnection(42, wire, extras);
  const send = (message: unknown) => conn.receive(new TextEncoder().encode(`${JSON.stringify(message)}\n`));
  return { conn, extras, written, send, terminated: () => terminated };
}

test("a connection's applets become extras; clicks and choices go back; they go when it closes", async () => {
  const { conn, extras, written, send } = connection();
  send({
    type: "applet",
    applet: {
      id: "w",
      title: "Weather",
      label: "21°",
      menu: [
        { id: "refresh", label: "Refresh" },
        { id: "off", label: "Off", enabled: false },
      ],
    },
  });
  send({ type: "applet", applet: { id: "t", title: "Timer", label: "4:59" } });
  const [timer, weather] = extras.getSnapshot();
  expect(weather?.title).toBe("Weather");
  expect(timer?.title).toBe("Timer");
  if (!weather || !timer) return;

  expect(await extras.menu(weather.key)).toEqual([
    { kind: "item", id: "refresh", label: "Refresh", enabled: true },
    { kind: "item", id: "off", label: "Off", enabled: false },
  ]);
  extras.choose(weather.key, "refresh");
  extras.choose(weather.key, "off");
  extras.choose(weather.key, "missing");
  extras.activate(timer.key, 1200.4, 24);
  expect(written.map((line) => JSON.parse(line))).toEqual([
    { type: "select", id: "w", item: "refresh" },
    { type: "activate", id: "t", x: 1200, y: 24 },
  ]);

  send({ type: "remove", id: "t" });
  expect(extras.getSnapshot().map((extra) => extra.title)).toEqual(["Weather"]);
  conn.closedBySocket();
  expect(extras.getSnapshot()).toEqual([]);
});

test("a refused message says why and keeps the applet; too many refusals end the connection", () => {
  const { extras, written, send, terminated } = connection();
  send({ type: "applet", applet: { id: "w", title: "Weather", label: "21°" } });
  send({ type: "applet", applet: { id: "w", title: "Weather" } });
  expect(JSON.parse(written[0] ?? "{}")).toMatchObject({ type: "error" });
  expect(extras.getSnapshot()).toHaveLength(1);
  for (let i = 0; i < 9; i++) send({ type: "nope" });
  expect(terminated()).toBe(true);
  expect(extras.getSnapshot()).toEqual([]);
});

test("one connection shows at most eight applets", () => {
  const { extras, written, send } = connection();
  for (let i = 0; i < 9; i++) send({ type: "applet", applet: { id: `a${i}`, title: "A", label: `${i}` } });
  expect(extras.getSnapshot()).toHaveLength(8);
  expect(JSON.parse(written.at(-1) ?? "{}")).toMatchObject({ type: "error", message: expect.stringContaining("more than 8") });
});
