/**
 * Measures the autohiding Dock's entrance: the real Dock (`startDock`), its
 * pointer policy and its host, in whatever compositor this runs in, with the
 * pointer's part played from here (an `edge` event in, then out), N times.
 *
 *   bun bench/dock-slide.tsx [entrances=20] [pinned app ids…]
 *
 * It prints `bench: in <ms>` when the pointer "reaches" the edge and
 * `bench: out <ms>` when it "leaves", in wall-clock ms, the clock of the
 * host's `MIRIN_METAL_TRACE=1` lines; `dock-slide-read.ts` reads the two
 * together. Run it with bench/dock-slide-run.sh, in a nested compositor, never
 * in the session: it opens a Dock.
 */

import { AppCatalog } from "../src/app-catalog.ts";
import type { CompositorEvent } from "../src/compositor/index.ts";
import { DockController, DockPrefs, PinStore, startDock } from "../src/dock/index.ts";
import { MenuController } from "../src/menus/index.ts";
import { ToplevelStore } from "../src/toplevels.ts";

// The runner (bench/dock-slide-run.sh) sets it inside its nested compositor: never a Dock in the session by mistake.
if (process.env.DOCK_BENCH_NESTED !== "1") {
  console.error("dock-slide: run it with bench/dock-slide-run.sh, in a nested compositor");
  process.exit(2);
}

const [countArg, ...pinArgs] = process.argv.slice(2);
const entrances = Number(countArg ?? 20);
const catalog = new AppCatalog().entries;
// What the Dock keeps: the ids given, else the first apps installed here.
const pinned = pinArgs.length > 0 ? pinArgs : catalog.slice(0, 10).map((entry) => entry.id);

type EdgeListener = (event: CompositorEvent) => void;
const listeners = new Set<EdgeListener>();
// The compositor's part: it takes the Dock's requests and says where the pointer is.
const compositor: NonNullable<Parameters<typeof startDock>[0]["compositor"]> = {
  inputRegion: async () => ({}),
  edges: async () => false,
  on(listener: EdgeListener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
const edge = (inside: boolean): void => {
  console.error(`bench: ${inside ? "in" : "out"} ${Date.now()}`);
  for (const listener of listeners) listener({ event: "edge", edge: "bottom", inside });
};

const prefs = new DockPrefs(() => {});
prefs.apply({ style: process.env.DOCK_BENCH_STYLE === "taskbar" ? "taskbar" : "dock", autohide: true, visible: true, magnify: true });
const pins = new PinStore({ defaults: pinned, path: null });
const toplevels = new ToplevelStore();
const controller = new DockController({ catalog, pins, toplevels, compositor: null, launch: () => null });
// The Dock opens no menu here.
const menus = new MenuController({
  context: async (appName) => ({ appName, windows: [], focused: null, canLaunch: false, canOpenHelp: false }),
  openSurface: () => ({ close: () => {} }),
});

const dock = startDock({
  prefs,
  apps: [],
  catalog,
  pins,
  toplevels,
  controller,
  menus,
  attention: null,
  compositor,
  onLost: () => console.error("bench: the Dock's host died"),
  reduceMotion: () => process.env.DOCK_BENCH_REDUCE_MOTION === "1",
});
dock.place(undefined);

const wait = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));
// Out long enough for the entrance to end (the wait at the edge, 120 ms, and the entrance, 640 ms);
// away long enough for the exit and the host's end (the wait to go, 600 ms, and the drop, 180 ms).
const OUT_MS = 120 + 640 + 200;
const AWAY_MS = 600 + 180 + 150;

await wait(Number(process.env.DOCK_BENCH_SETTLE_MS ?? 1500));
for (let round = 0; round < entrances; round++) {
  edge(true);
  await wait(OUT_MS);
  edge(false);
  await wait(AWAY_MS);
}
console.error(`bench: done ${Date.now()}`);
dock.close();
controller.close();
process.exit(0);
