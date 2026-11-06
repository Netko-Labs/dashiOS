import { afterEach, expect, test } from "bun:test";
import { type ActionDef, type Outcome, type PickRow, ready, type Shown } from "../src/actions/types.ts";
import { KEYMAP } from "../src/keymap.ts";
import { slowSections, viewRows } from "../src/launcher/extension-rows.ts";
import { ExtensionSession, readArg, viewFrame } from "../src/launcher/extensions.ts";
import type { LauncherHost, LauncherWorldStore } from "../src/launcher/host.ts";
import { launcherIndex, launcherItems, outsideName } from "../src/launcher/items.ts";
import { found } from "../src/launcher/rows.ts";
import type { WorldSnapshot } from "../src/launcher/world.ts";
import { LAUNCHER } from "../src/launcher.tsx";
import { app, mount, settle, unmountLauncher } from "./launcher-harness.tsx";

// Wave 3 in the panel: rows from outside Dashi (applets' commands, your scripts, GNOME's search providers),
// marked as theirs, below Dashi's own, and what a command asks to show after it ran.

afterEach(unmountLauncher);

/** A host whose run carries the action out, as the shell's does. */
function runningHost(log: string[]): LauncherHost {
  return {
    run: async (action, args = {}) => {
      log.push(`run ${action.address}${Object.keys(args).length > 0 ? ` ${JSON.stringify(args)}` : ""}`);
      const checked = action.check(args);
      return checked.ok ? checked.run({ window: null }) : { ok: false, error: checked.error };
    },
    reveal: () => {},
    focus: async () => {},
    newWindow: () => true,
    bringHere: async () => {},
    minimize: async () => {},
    close: async () => {},
    quit: async () => {},
    showInFiles: () => {},
    trash: async () => true,
    pinned: () => null,
    pin: () => {},
    keymap: () => KEYMAP,
    describe: (bind) => bind,
  };
}

function command(id: string, title: string, run: (args: Record<string, unknown>) => Promise<Outcome>, extra: Partial<ActionDef> = {}): ActionDef {
  return {
    address: `dashi://applet/dev.example.weather/${id}`,
    title,
    description: "",
    keywords: { en: ["Weather"] },
    kind: "run",
    properties: {},
    scope: null,
    readOnly: false,
    destructive: false,
    who: "person",
    source: "applets",
    from: "Weather",
    check: (args) => ready(() => run(args)),
    ...extra,
  };
}

const world = (actions: ActionDef[]): LauncherWorldStore => {
  const full: WorldSnapshot = { actions, windows: [], serial: 0 };
  return { subscribe: () => () => {}, getSnapshot: () => full };
};

const NOW = command("now", "Weather now", async () => ({ ok: true, text: "21° and clear", show: { kind: "text", text: "21° and clear" } }));

test("an applet's command says whose it is, and its answer is the top row, selected, the launcher still open", async () => {
  const log: string[] = [];
  const launcher = await mount({ entries: [], host: runningHost(log), world: world([NOW]) }, ["action:dashi://applet/dev.example.weather/now", "result"]);
  await launcher.type("weather now");
  expect(launcher.rows().ids).toEqual(["action:dashi://applet/dev.example.weather/now"]);
  expect(launcher.tree()).toContain("Weather");
  await launcher.enter();
  await settle();
  expect(log).toEqual(["run dashi://applet/dev.example.weather/now"]);
  expect(launcher.rows()).toEqual({ ids: ["result", "action:dashi://applet/dev.example.weather/now"], selected: "result" });
  expect(launcher.tree()).toContain("21° and clear");
  expect(launcher.closed).toEqual([]);
});

test("a pick command: a chip names it, its rows come as you type, and the one chosen answers", async () => {
  const log: string[] = [];
  const asked: string[] = [];
  const cities: PickRow[] = [
    { id: "lisbon", title: "Lisbon, now 19°", detail: "clear" },
    { id: "oslo", title: "Oslo, now 4°", detail: "snow" },
  ];
  const pick: Shown = {
    kind: "pick",
    title: "Weather in a city",
    ask: async (query) => {
      asked.push(query);
      return cities.filter((city) => city.title.toLowerCase().startsWith(query));
    },
    choose: async (row) => ({ ok: true, text: row.title, show: { kind: "text", text: `${row.title}, chosen` } }),
  };
  const city = command("city", "Weather in a city", async () => ({ ok: true, text: "Weather in a city", show: pick }), { kind: "pick" });
  const session = new ExtensionSession(() => []);
  const launcher = await mount({ entries: [], host: runningHost(log), world: world([city]), extensions: session }, [
    "action:dashi://applet/dev.example.weather/city",
    "pick:lisbon",
    "pick:oslo",
    "result",
  ]);
  await launcher.type("weather in");
  await launcher.enter();
  await settle(20);
  expect(launcher.has("launcher:chip")).toBe(true);
  expect(launcher.tree()).toContain("Search Weather");
  expect(launcher.rows().ids).toEqual(["pick:lisbon", "pick:oslo"]);
  await launcher.type("lis");
  await settle(20);
  expect(asked).toEqual(["", "lis"]);
  expect(launcher.rows()).toEqual({ ids: ["pick:lisbon"], selected: "pick:lisbon" });
  await launcher.enter();
  await settle(20);
  // The scope is left, and its answer is the top row.
  expect(launcher.has("launcher:chip")).toBe(false);
  expect(launcher.tree()).toContain("Lisbon, now 19°, chosen");
  expect(launcher.rows().selected).toBe("result");
});

test("a command that needs words asks for them in the field, one at a time, then runs with them", async () => {
  const log: string[] = [];
  const hello = command(
    "hello",
    "Say hello",
    async (args) => ({ ok: true, text: `Hello, ${String(args.name)}`, show: { kind: "text", text: `Hello, ${String(args.name)}` } }),
    {
      address: "dashi://script/hello.sh",
      source: "scripts",
      from: "Script",
      properties: { name: { type: "string", description: "Name" } },
      required: ["name"],
    },
  );
  const launcher = await mount({ entries: [], host: runningHost(log), world: world([hello]) }, ["action:dashi://script/hello.sh", "arg", "result"]);
  await launcher.type("say hello");
  await launcher.enter();
  expect(log).toEqual([]);
  expect(launcher.rows().ids).toEqual(["arg"]);
  // Return with nothing typed asks again.
  await launcher.enter();
  expect(log).toEqual([]);
  await launcher.type("Alex");
  await launcher.enter();
  await settle();
  expect(log).toEqual(['run dashi://script/hello.sh {"name":"Alex"}']);
  expect(launcher.tree()).toContain("Hello, Alex");
  // Esc steps out of it as it does out of a chip.
  await launcher.type("say hello");
  await launcher.enter();
  expect(launcher.has("launcher:chip")).toBe(true);
  await launcher.key("Escape");
  expect(launcher.has("launcher:chip")).toBe(false);
});

test("a search provider's results go below Dashi's rows under its name, and run as you", async () => {
  const log: string[] = [];
  const opened: string[] = [];
  const provider = {
    id: "org.gnome.Characters.BackgroundService/org/gnome/Characters/SearchProvider",
    label: "Characters",
    ask: async (query: string) => [
      {
        id: "é",
        title: "LATIN SMALL LETTER E WITH ACUTE",
        icon: "/c.svg",
        run: async (): Promise<Outcome> => {
          opened.push(query);
          return { ok: true, text: "Opened." };
        },
      },
    ],
  };
  const session = new ExtensionSession(() => [provider]);
  const id = `slow:${provider.id}:é`;
  const launcher = await mount({ entries: [app("Acute Notes")], host: runningHost(log), extensions: session }, ["entry:app.acute-notes", id]);
  await launcher.type("acute");
  await settle(20);
  expect(launcher.rows().ids).toEqual(["entry:app.acute-notes", id]);
  expect(launcher.tree()).toContain("Characters");
  await launcher.key("ArrowDown");
  await launcher.enter();
  await settle();
  expect(opened).toEqual(["acute"]);
  expect(log).toEqual(["run dashi://search/org.gnome.Characters.BackgroundService-org-gnome-Characters-SearchProvider"]);
});

test("a provider's results for a query nothing of Dashi's matches land below “Nothing called …”, which stays on top", async () => {
  const provider = {
    id: "org.gnome.Characters.BackgroundService/org/gnome/Characters/SearchProvider",
    label: "Characters",
    ask: async () => {
      await settle(30);
      return [{ id: "smile", title: "SMILING FACE", icon: "/c.svg", run: async (): Promise<Outcome> => ({ ok: true, text: "Opened." }) }];
    },
  };
  const session = new ExtensionSession(() => [provider]);
  const files = { ...app("Files"), id: "dev.dashi.files" };
  const software = { ...app("Software"), id: "dev.dashi.software" };
  const candidates = ["search-files", "find-software", `slow:${provider.id}:smile`];
  const launcher = await mount({ entries: [files, software], extensions: session }, candidates);
  await launcher.type("smile");
  expect(launcher.rows()).toEqual({ ids: ["search-files", "find-software"], selected: "search-files" });
  await settle(60);
  // The provider answered: its row goes under the rest; the head, the rows and the selection hold still.
  expect(launcher.rows()).toEqual({ ids: candidates, selected: "search-files" });
  expect(launcher.tree()).toContain("Nothing called “smile”");
});

test("rows from outside never outrank an exact match of a name Dashi or an app gave, and can't take a first-party one", () => {
  const spoof = command("settings", "System Settings", async () => ({ ok: true, text: "" }));
  const weather = command("weather", "Weather", async () => ({ ok: true, text: "" }));
  const entries = [
    { ...app("Weather"), id: "org.example.Weather" },
    { ...app("System Settings"), id: "dev.dashi.settings", shell: true as const },
  ];
  const items = launcherItems({ entries, actions: [spoof, weather] });
  const titles = items.flatMap((item) => (item.action ? [item.action.title] : []));
  expect(titles).toEqual(["Weather › System Settings", "Weather"]);
  expect(items.filter((item) => item.action).every((item) => item.foreign)).toBe(true);
  const index = launcherIndex({ entries, actions: [spoof, weather] });
  const ranked = found({ query: "weather", entries, recent: [], files: { kind: "none" }, index, icons: { calculator: "", files: "", software: "" } }, 5).items;
  expect(ranked[0]?.id).toBe("org.example.Weather");
  expect(outsideName(weather, new Set(["system settings"]))).toBe(weather);
});

test("the pure pieces: slow sections, a view's room and place, and an argument's words", () => {
  expect(slowSections(null)).toEqual([]);
  const sections = slowSections({
    seq: 1,
    query: "e",
    sources: [
      { id: "a", label: "Characters", state: { kind: "answered", rows: [{ id: "1", title: "E", run: async () => ({ ok: true, text: "" }) }], isLate: true } },
      { id: "b", label: "Contacts", state: { kind: "slow" } },
    ],
  });
  expect(sections.map((section) => [section.id, section.title, section.aside, section.rows.length])).toEqual([["slow:a", "Characters", "slow", 1]]);
  expect(sections[0]?.rows[0]?.icon).toEqual({ glyph: expect.stringContaining("<svg") });
  expect(viewRows(160)).toBe(4);
  expect(viewRows(900)).toBe(10);
  expect(viewFrame(4, LAUNCHER)).toEqual({ x: 6, y: 55, width: 608, height: 160 });
  // At a larger text size the view sits under the taller field, in rows of the taller height.
  expect(viewRows(160, 50)).toBe(4);
  expect(viewFrame(4, { width: LAUNCHER.width, padding: LAUNCHER.padding, field: 60, row: 50 })).toEqual({ x: 6, y: 67, width: 608, height: 200 });
  expect(readArg(" 3 ", { type: "number" })).toBe(3);
  expect(readArg("x", { type: "number" })).toBeNull();
  expect(readArg("yes", { type: "boolean" })).toBe(true);
  expect(readArg(" Lisbon ", { type: "string" })).toBe("Lisbon");
});
