import { expect, test } from "bun:test";
import type { GraphicsCard } from "../src/graphics/card.ts";
import {
  type CardwireGpu,
  type CardwireMode,
  cardwireClient,
  type GraphicsBackend,
  parseGpuDevice,
  parseLsof,
  parsePolicies,
} from "../src/graphics/cardwire.ts";
import { GraphicsController } from "../src/graphics/controller.ts";
import { AWAKE_WATTS, groupHolders, holdingProcesses, type ProcessFds } from "../src/graphics/holders.ts";
import { decideGraphics, type GraphicsInputs } from "../src/graphics/policy.ts";
import type { GraphicsChoice } from "../src/power/modes/settings.ts";
import { FakeBus, settle } from "./fake-bus.ts";

const base: GraphicsInputs = { choice: "automatic", plugged: false, cardScreens: [], holders: [], current: "hybrid", lost: false };

test("Automatic: Integrated on battery, Hybrid plugged in", () => {
  expect(decideGraphics(base)).toMatchObject({ set: "integrated", wanted: "integrated", waitingFor: [] });
  expect(decideGraphics({ ...base, plugged: true })).toMatchObject({ set: null, wanted: "hybrid" });
  expect(decideGraphics({ ...base, plugged: true, current: "integrated" })).toMatchObject({ set: "hybrid", why: "Automatic chose Hybrid: plugged in" });
});

test("Automatic: a screen on the card's ports keeps Hybrid on battery", () => {
  expect(decideGraphics({ ...base, cardScreens: ["HDMI-A-1"] })).toMatchObject({
    set: null,
    wanted: "hybrid",
    why: "Automatic chose Hybrid: a screen is connected to the graphics card (HDMI-A-1)",
  });
});

test("apps already on the card are never pulled off: Integrated waits for them", () => {
  expect(decideGraphics({ ...base, holders: ["Steam"] })).toEqual({
    set: null,
    wanted: "integrated",
    waitingFor: ["Steam"],
    why: "Switches to the built-in graphics when Steam quits",
  });
  expect(decideGraphics({ ...base, holders: ["Steam", "Helium"] }).why).toBe("Switches to the built-in graphics when Steam and Helium quit");
  // Going up to Hybrid never waits.
  expect(decideGraphics({ ...base, plugged: true, current: "integrated", holders: ["Steam"] }).set).toBe("hybrid");
});

test("a manual pick is applied as asked; a lost card stops all switching", () => {
  expect(decideGraphics({ ...base, choice: "smart", holders: ["Steam"] })).toMatchObject({ set: "smart", waitingFor: [] });
  expect(decideGraphics({ ...base, choice: "hybrid" }).set).toBeNull();
  expect(decideGraphics({ ...base, lost: true })).toMatchObject({ set: null, wanted: null });
  // cardwire's own Manual counts as none of Dashi's modes: Automatic takes over.
  expect(decideGraphics({ ...base, current: "manual", plugged: true }).set).toBe("hybrid");
});

/** The G14's NVIDIA card, as card.ts reads it. */
const CARD: GraphicsCard = {
  name: "card0",
  driver: "nvidia",
  pci: "0000:64:00.0",
  port: "0000:00:03.1",
  nodes: ["/dev/dri/card0", "/dev/dri/renderD128", "/dev/nvidia0"],
  screens: [],
};

const procs: ProcessFds[] = [
  { pid: 5964, comm: "steamwebhelper", links: ["/dev/null", "/dev/dri/renderD128", "/dev/nvidiactl"] },
  { pid: 5900, comm: "steam", links: ["/dev/nvidia0", "/dev/nvidia0"] },
  { pid: 7000, comm: "helium", links: ["/dev/dri/renderD129"] },
  { pid: 7100, comm: "mpv", links: ["/dev/dri/card0"] },
  { pid: 4242, comm: "dashi-shell", links: ["/dev/dri/card0"] },
];

test("holders: the processes with the card's own nodes open, never the built-in GPU's or the shell itself", () => {
  expect(holdingProcesses(procs, CARD.nodes, 4242).map((proc) => proc.pid)).toEqual([5964, 5900, 7100]);
  // nvidiactl alone isn't the card.
  expect(holdingProcesses([{ pid: 1, comm: "x", links: ["/dev/nvidiactl"] }], CARD.nodes, 0)).toEqual([]);
  // The compositor holds it only for a screen, a client, or the shell: never a holder to quit.
  expect(holdingProcesses([{ pid: 2, comm: "dashi-comp", links: [...CARD.nodes] }], CARD.nodes, 0)).toEqual([]);
  expect(groupHolders([], (_pid, comm) => comm, ["dashi-comp"], null)).toEqual([]);
});

test("holders by app, with the draw shared out; names only cardwire saw are listed without Quit", () => {
  const holding = holdingProcesses(procs, CARD.nodes, 4242);
  const appOf = (pid: number) => (pid === 5964 || pid === 5900 ? "Steam" : null);
  const holders = groupHolders(holding, (pid, comm) => appOf(pid) ?? comm, ["steamwebhelper", "gamescope"], 38);
  expect(holders).toEqual([
    { name: "Steam", pids: [5964, 5900], watts: 12.7 },
    { name: "mpv", pids: [7100], watts: 12.7 },
    { name: "gamescope", pids: [], watts: 12.7 },
  ]);
  // No draw reported: the typical cost of an awake card.
  expect(groupHolders(holding.slice(0, 1), () => "Steam", [], null)[0]?.watts).toBe(AWAKE_WATTS);
  expect(groupHolders([], () => "", [], null)).toEqual([]);
});

test("cardwire's replies: the device struct, Lsof's map, the app policies", () => {
  expect(
    parseGpuDevice("/org/opengamingcollective/cardwire/Gpu/1", ["NVIDIA GeForce RTX 5070 Ti", "0000:64:00.0", 128, 0, false, 1, "Nvidia", "nvidia", new Map()]),
  ).toEqual({
    path: "/org/opengamingcollective/cardwire/Gpu/1",
    name: "NVIDIA GeForce RTX 5070 Ti",
    pci: "0000:64:00.0",
    card: 0,
    isDefault: false,
    discrete: true,
    driver: "nvidia",
  });
  expect(parseGpuDevice("/x", ["only a name"])).toBeNull();
  expect(
    parseLsof(
      new Map([
        ["/dev/dri/card0", ["steam"]],
        ["/dev/nvidia0", ["steam", "steamwebhelper"]],
      ]),
    ),
  ).toEqual(["steam", "steamwebhelper"]);
  expect(
    parsePolicies(
      new Map([
        ["com.valvesoftware.Steam", ["Steam", ["com.valvesoftware.Steam.desktop"], [], 1]],
        ["org.blender.Blender", ["Blender", [], [], 0]],
      ]),
    ),
  ).toEqual([
    { id: "com.valvesoftware.Steam", name: "Steam", allowed: true },
    { id: "org.blender.Blender", name: "Blender", allowed: false },
  ]);
});

test("the cardwire client: no service is no cardwire; Mode reads and sets as a number", async () => {
  expect(await cardwireClient(new FakeBus().link()).mode()).toBeNull();
  let mode = 1;
  const bus = new FakeBus()
    .on("/org/opengamingcollective/cardwire", "org.freedesktop.DBus.Properties", "GetAll", () => [new Map([["Mode", mode]])])
    .on("/org/opengamingcollective/cardwire", "org.freedesktop.DBus.Properties", "Set", ([, , value]) => {
      mode = (value as { value: number }).value;
      return [];
    });
  const client = cardwireClient(bus.link());
  expect(await client.mode()).toBe("hybrid");
  expect(await client.setMode("integrated")).toBe(true);
  expect(await client.mode()).toBe("integrated");
});

test("the cardwire client: Dashi turns cardwire's own switching off, and only what is on", async () => {
  const config = new Map<string, unknown>([
    ["BatteryAutoSwitch", true],
    ["ExternalDisplayAutoSwitch", false],
    ["AutoApplyGpuState", true],
  ]);
  const sets: string[] = [];
  const bus = new FakeBus()
    .on("/org/opengamingcollective/cardwire", "org.freedesktop.DBus.Properties", "GetAll", ([iface]) =>
      iface === "org.opengamingcollective.cardwire.Config" ? [config] : [new Map()],
    )
    .on("/org/opengamingcollective/cardwire", "org.freedesktop.DBus.Properties", "Set", ([iface, name, value]) => {
      sets.push(`${String(iface)} ${String(name)}=${String((value as { value: unknown }).value)}`);
      return [];
    });
  await cardwireClient(bus.link()).takeOver();
  expect(sets).toEqual(["org.opengamingcollective.cardwire.Config BatteryAutoSwitch=false"]);
  // Without cardwire there is nothing to turn off, and nothing throws.
  await cardwireClient(new FakeBus().link()).takeOver();
});

function fakeBackend(mode: CardwireMode) {
  const state = { mode, sets: [] as CardwireMode[] };
  const gpu: CardwireGpu = { path: "/g/1", name: "RTX", pci: CARD.pci, card: 0, isDefault: false, discrete: true, driver: "nvidia" };
  const backend: GraphicsBackend = {
    mode: async () => state.mode,
    setMode: async (next) => {
      state.sets.push(next);
      state.mode = next;
      return true;
    },
    gpus: async () => [gpu],
    holders: async () => [],
    allowed: async () => [],
    onModeChanged: () => () => {},
    takeOver: async () => {},
  };
  return { backend, state };
}

test("the controller: unplugging with Steam on the card waits, says so once, and switches when Steam quits", async () => {
  const { backend, state } = fakeBackend("hybrid");
  let running: ProcessFds[] = [procs[1] as ProcessFds];
  const said: string[][] = [];
  let choice: GraphicsChoice = "automatic";
  const controller = new GraphicsController({
    card: CARD,
    backend,
    choice: () => choice,
    saveChoice: (next) => {
      choice = next;
    },
    appOf: () => "Steam",
    sayWaiting: (names) => void said.push([...names]),
    processes: () => running,
    screens: () => [],
    power: () => "active",
    cardWatts: () => null,
    signal: () => {},
  });
  await controller.start();
  controller.setPlugged(false);
  await settle();
  await controller.refresh();
  expect(controller.getSnapshot().decision?.waitingFor).toEqual(["Steam"]);
  expect(state.sets).toEqual([]);
  expect(said).toEqual([["Steam"]]);
  running = [];
  await controller.refresh();
  expect(state.sets).toEqual(["integrated"]);
  expect(said.length).toBe(1);
  controller.close();
});

test("one GPU, or no cardwire: nothing to switch, nothing said", async () => {
  const none = new GraphicsController({ card: null, backend: null, choice: () => "automatic", saveChoice: () => {} });
  await none.start();
  expect(none.getSnapshot()).toMatchObject({ hasCard: false, switchable: false, holders: [] });
  const said: string[][] = [];
  const noCardwire = new GraphicsController({
    card: CARD,
    backend: null,
    choice: () => "automatic",
    saveChoice: () => {},
    sayWaiting: (names) => void said.push([...names]),
    processes: () => procs,
    screens: () => [],
    power: () => "active",
    cardWatts: () => null,
  });
  await noCardwire.start();
  noCardwire.setPlugged(false);
  await noCardwire.refresh();
  expect(noCardwire.getSnapshot()).toMatchObject({ hasCard: true, switchable: false });
  expect(noCardwire.getSnapshot().holders.length).toBeGreaterThan(0);
  expect(said).toEqual([]);
  noCardwire.close();
});
