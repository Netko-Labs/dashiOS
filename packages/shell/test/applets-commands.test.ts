import { expect, test } from "bun:test";
import { type Manifest, parseManifest } from "@dashi/applet";
import type { Outcome, Shown } from "../src/actions/types.ts";
import { AppletCommands, type CommandTimers, commandAddress } from "../src/applets/commands.ts";
import { systemdUnits, UNIT_LIMITS } from "../src/applets/units.ts";
import { AppletConnection } from "../src/applets/lib/connection.ts";
import { sameManifest } from "../src/applets/lib/extra.ts";
import { AppletGrants } from "../src/applets/lib/grants.ts";
import { ExtrasStore } from "../src/extras/index.ts";
import { abilityLines, commandsLine } from "../src/shared/applet-store/consent-sheet.tsx";
import { settle } from "./support/time.ts";

const MANIFEST = {
  id: "dev.example.weather",
  name: "Weather",
  version: "0.1.0",
  dashi: ">=0.4",
  entry: "src/main.tsx",
  summary: "The weather where you are.",
  author: { name: "Alex Kim" },
  permissions: [],
  commands: [
    { id: "now", title: "Weather now", keywords: ["temperature"], mode: "instant" },
    { id: "city", title: "Weather in a city", mode: "pick" },
    { id: "glance", title: "Weather at a glance", mode: "view" },
    { id: "for", title: "Weather for", mode: "instant", args: [{ name: "city", type: "string", title: "City", required: true }] },
  ],
};

function manifest(extra: Record<string, unknown> = {}): Manifest {
  const parsed = parseManifest({ ...MANIFEST, ...extra });
  if ("error" in parsed) throw new Error(parsed.error);
  return parsed;
}

/** Timers the test fires by hand. */
function manualTimers(): CommandTimers & { fire(): void } {
  const waiting = new Map<number, () => void>();
  let next = 0;
  return {
    set: (callback) => {
      waiting.set(++next, callback);
      return next;
    },
    clear: (handle) => void waiting.delete(handle as number),
    fire: () => {
      for (const [handle, callback] of [...waiting]) {
        waiting.delete(handle);
        callback();
      }
    },
  };
}

function harness() {
  const written: Array<Record<string, unknown>> = [];
  const extras = new ExtrasStore();
  const grantsAsked: unknown[] = [];
  const grants = new AppletGrants({
    appletClients: async (params) => {
      grantsAsked.push(params);
      return {};
    },
  });
  const copied: string[] = [];
  const opened: string[] = [];
  const timers = manualTimers();
  const commands = new AppletCommands({
    copy: async (text) => {
      copied.push(text);
      return true;
    },
    open: async (target) => {
      opened.push(target);
      return { ok: true, text: `Opened ${target}` };
    },
    launcherOrigin: async () => ({ output: "eDP-1", x: 410, y: 148 }),
    timers,
  });
  const wire = {
    write: (data: Uint8Array) => {
      for (const line of new TextDecoder().decode(data).split("\n")) if (line) written.push(JSON.parse(line));
      return data.byteLength;
    },
    terminate: () => {},
  };
  const conn = new AppletConnection(4242, wire, { extras, grants, commands });
  const send = (message: unknown) => conn.receive(new TextEncoder().encode(`${JSON.stringify(message)}\n`));
  const runs = () => written.filter((message) => message.type === "run");
  const action = (id: string) => {
    const found = commands.actions().find((each) => each.address === commandAddress("dev.example.weather", id));
    if (!found) throw new Error(`no ${id}`);
    return found;
  };
  const run = async (id: string, args: Record<string, unknown> = {}): Promise<Outcome> => {
    const checked = action(id).check(args);
    if (!checked.ok) return { ok: false, error: checked.error };
    return checked.run({ window: null });
  };
  return { conn, commands, written, send, settle, runs, action, run, copied, opened, timers, grantsAsked };
}

test("a version 3 hello: welcomed as 3, and its commands are actions marked as the applet's", () => {
  const { send, written, commands } = harness();
  send({ type: "hello", protocol: 3, manifest: MANIFEST });
  expect(written[0]).toEqual({ type: "welcome", protocol: 3 });
  const actions = commands.actions();
  expect(actions.map((each) => [each.address, each.kind, each.from, each.source])).toEqual([
    ["dashi://applet/dev.example.weather/now", "run", "Weather", "applets"],
    ["dashi://applet/dev.example.weather/city", "pick", "Weather", "applets"],
    ["dashi://applet/dev.example.weather/glance", "open", "Weather", "applets"],
    ["dashi://applet/dev.example.weather/for", "run", "Weather", "applets"],
  ]);
  expect(actions[0]?.keywords).toEqual({ en: ["temperature", "Weather"] });
  expect(actions[3]?.properties).toEqual({ city: { type: "string", description: "City" } });
  expect(actions[3]?.check({})).toEqual({ ok: false, error: "It needs “City”." });
});

test("an applet in development shows its own commands, even when an older copy without them is installed", () => {
  const { send, commands } = harness();
  // The installed copy (no commands yet), as the VM had it.
  commands.setInstalled([{ manifest: manifest({ commands: [] }), dir: "/home/alexk/.local/share/dashi/applets/dev.example.weather" }]);
  expect(commands.actions()).toEqual([]);
  send({ type: "hello", protocol: 3, manifest: MANIFEST, dev: true });
  expect(commands.actions().map((each) => each.address)).toContain("dashi://applet/dev.example.weather/now");
});

test("a newer applet gets the shell's version; an older one stays at 2 and can't send version 3's messages", () => {
  const newer = harness();
  newer.send({ type: "hello", protocol: 7, manifest: MANIFEST });
  expect(newer.written[0]).toEqual({ type: "welcome", protocol: 5 });
  const older = harness();
  older.send({ type: "hello", protocol: 2, manifest: MANIFEST });
  expect(older.written[0]).toEqual({ type: "welcome", protocol: 2 });
  // Its commands aren't answered on this connection, so they aren't offered from it.
  expect(older.commands.actions()).toEqual([]);
  older.send({ type: "result", seq: 1, text: "21°" });
  expect(older.written[1]).toMatchObject({ type: "error", message: expect.stringContaining("protocol 3") });
});

test("an instant command: run with a seq, its line shown, its copy put on the clipboard, its open opened", async () => {
  const h = harness();
  h.send({ type: "hello", protocol: 3, manifest: MANIFEST });
  const now = h.run("now");
  expect(h.runs()).toEqual([{ type: "run", seq: 1, command: "now", args: {} }]);
  // An answer to a run it wasn't sent is no answer.
  h.send({ type: "result", seq: 99, text: "nope" });
  h.send({ type: "result", seq: 1, text: "21° and clear" });
  expect(await now).toEqual({ ok: true, text: "21° and clear", show: { kind: "text", text: "21° and clear" } });

  const copy = h.run("for", { city: "Lisbon" });
  expect(h.runs()[1]).toEqual({ type: "run", seq: 2, command: "for", args: { city: "Lisbon" } });
  h.send({ type: "result", seq: 2, copy: "Lisbon: 19°" });
  expect(await copy).toEqual({ ok: true, text: "Copied" });
  expect(h.copied).toEqual(["Lisbon: 19°"]);

  const open = h.run("now");
  h.send({ type: "result", seq: 3, open: "https://example.com/forecast" });
  expect(await open).toEqual({ ok: true, text: "Opened https://example.com/forecast" });

  const refused = h.run("now");
  h.send({ type: "result", seq: 4, error: "No signal" });
  expect(await refused).toEqual({ ok: false, error: "No signal" });
});

test("a command that isn't answered gives up; one whose applet isn't running says so", async () => {
  const h = harness();
  expect(h.commands.actions()).toEqual([]);
  h.commands.setInstalled([{ manifest: manifest(), dir: "/apps/weather" }]);
  // Listed before it ever runs.
  expect(h.commands.actions()).toHaveLength(4);
  expect(await h.run("now")).toEqual({ ok: false, error: "Weather isn't running." });
  h.send({ type: "hello", protocol: 3, manifest: MANIFEST });
  const waiting = h.run("now");
  h.timers.fire();
  expect(await waiting).toEqual({ ok: false, error: "Weather didn't answer." });
  // The connection goes: anything still waiting is answered, and the installed applet's commands stay listed.
  const pending = h.run("now");
  h.conn.closedBySocket();
  expect(await pending).toEqual({ ok: false, error: "Weather stopped." });
  expect(h.commands.actions()).toHaveLength(4);
});

test("a pick command: rows for each query, and the chosen row runs", async () => {
  const h = harness();
  h.send({ type: "hello", protocol: 3, manifest: MANIFEST });
  const started = await h.run("city");
  if (!started.ok || started.show?.kind !== "pick") throw new Error("not a pick");
  const pick = started.show;
  expect(pick.title).toBe("Weather in a city");
  const rows = pick.ask("lis");
  expect(h.runs()).toEqual([{ type: "run", seq: 1, command: "city", args: {}, query: "lis" }]);
  h.send({ type: "items", seq: 1, rows: [{ id: "lisbon", title: "Lisbon, now 19°", detail: "clear" }] });
  expect(await rows).toEqual([{ id: "lisbon", title: "Lisbon, now 19°", detail: "clear" }]);
  const chosen = pick.choose({ id: "lisbon", title: "Lisbon, now 19°" });
  expect(h.runs()[1]).toEqual({ type: "run", seq: 2, command: "city", args: {}, item: "lisbon" });
  h.send({ type: "result", seq: 2, text: "Lisbon: 19°, clear" });
  expect(await chosen).toMatchObject({ ok: true, show: { kind: "text", text: "Lisbon: 19°, clear" } });
  // Rows that fail say why.
  const failing = pick.ask("x");
  h.send({ type: "result", seq: 3, error: "Offline" });
  await expect(failing).rejects.toThrow("Offline");
});

test("a view: asked for, granted the layer shell, placed where the launcher's rows are, and dismissed either way", async () => {
  const h = harness();
  h.send({ type: "hello", protocol: 3, manifest: MANIFEST });
  const running = h.run("glance");
  h.send({ type: "view", seq: 1, height: 160 });
  const started = await running;
  if (!started.ok || started.show?.kind !== "view") throw new Error("not a view");
  const view = started.show as Extract<Shown, { kind: "view" }>;
  expect(view.height).toBe(160);
  let closed = 0;
  view.onClose(() => closed++);
  view.place({ x: 6, y: 55, width: 608, height: 160 });
  await h.settle();
  expect(h.grantsAsked.at(-1)).toEqual({ applets: [{ pid: 4242, layerShell: true }] });
  expect(h.written.at(-1)).toEqual({
    type: "view",
    seq: 1,
    namespace: "dashi.applet.dev.example.weather.view",
    x: 416,
    y: 203,
    width: 608,
    height: 160,
    output: "eDP-1",
  });
  // The launcher closes it: dismiss goes to the applet, the grant goes.
  view.close();
  await h.settle();
  expect(h.written.at(-1)).toEqual({ type: "dismiss", seq: 1 });
  expect(h.grantsAsked.at(-1)).toEqual({ applets: [{ pid: 4242, layerShell: false }] });
  expect(closed).toBe(1);

  // The applet closes the next one itself: the launcher hears it.
  const again = h.run("glance");
  h.send({ type: "view", seq: 2, height: 80 });
  const second = await again;
  if (!second.ok || second.show?.kind !== "view") throw new Error("not a view");
  let heard = 0;
  second.show.onClose(() => heard++);
  h.send({ type: "dismiss", seq: 2 });
  expect(heard).toBe(1);
});

test("an installed applet must say hello with its commands as installed", () => {
  const installed = manifest();
  expect(sameManifest(manifest(), installed)).toBe(true);
  expect(sameManifest(manifest({ commands: [] }), installed)).toBe(false);
});

test("the consent sheet says what it adds to the launcher, and the units have limits", () => {
  expect(commandsLine(manifest())).toBe("Adds 4 commands to the launcher");
  expect(commandsLine(manifest({ commands: [{ id: "a", title: "A", mode: "instant" }] }))).toBe("Adds 1 command to the launcher");
  expect(commandsLine(manifest({ commands: [] }))).toBeNull();
  expect(abilityLines(manifest())).toEqual([]);
  expect(UNIT_LIMITS).toEqual(["CPUQuota=50%", "MemoryMax=768M", "Nice=10"]);
  expect(typeof systemdUnits.start).toBe("function");
});
