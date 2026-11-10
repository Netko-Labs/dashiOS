import { expect, test } from "bun:test";
import type { GraphicsCard } from "../src/graphics/card.ts";
import type { CardwireGpu, CardwireMode, GraphicsBackend } from "../src/graphics/cardwire.ts";
import { GraphicsController } from "../src/graphics/controller.ts";
import type { ProcessFds } from "../src/graphics/holders.ts";
import { NOTICE_QUIET_MS, NOTICE_SETTLE_MS } from "../src/graphics/notice.ts";
import { graphicsNoticePlace } from "../src/graphics/notice-place.ts";
import { NotificationStore } from "../src/notifications/store.ts";
import type { GraphicsChoice } from "../src/power/modes/settings.ts";
import { fakeTime } from "./support/graphics-notice.ts";
import { settle } from "./support/time.ts";

const CARD: GraphicsCard = { name: "card0", driver: "nvidia", pci: "0000:64:00.0", port: "0000:00:03.1", nodes: ["/dev/nvidia0"], screens: [] };

function controllerWith(running: () => ProcessFds[]) {
  const time = fakeTime();
  const state = { mode: "hybrid" as CardwireMode, fail: false };
  const gpu: CardwireGpu = { path: "/g/1", name: "RTX", pci: CARD.pci, card: 0, isDefault: false, discrete: true, driver: "nvidia" };
  const backend: GraphicsBackend = {
    mode: async () => state.mode,
    setMode: async (next) => {
      if (state.fail) return false;
      state.mode = next;
      return true;
    },
    gpus: async () => [gpu],
    holders: async () => [],
    allowed: async () => [],
    onModeChanged: () => () => {},
    takeOver: async () => {},
  };
  // The one place graphics notices have, as laptop/start.ts keeps it.
  const place: { shown: string | null; log: string[] } = { shown: null, log: [] };
  let choice: GraphicsChoice = "automatic";
  const controller = new GraphicsController({
    card: CARD,
    backend,
    choice: () => choice,
    saveChoice: (next) => {
      choice = next;
    },
    appOf: () => "Steam",
    sayWaiting: () => {
      place.shown = "waiting";
      place.log.push("waiting");
    },
    sayChanged: (notice) => {
      place.shown = notice.body;
      place.log.push(notice.body);
    },
    withdrawWaiting: () => {
      place.shown = null;
      place.log.push("withdrawn");
    },
    rate: (plugged) => (plugged ? "120 Hz" : "60 Hz"),
    processes: running,
    screens: () => [],
    power: () => "active",
    cardWatts: () => null,
    signal: () => {},
    now: time.now,
    later: time.later,
  });
  return { controller, time, state, place };
}

test("the controller: unplug says it once with the rate; a pick in the tile says nothing; a failure says nothing", async () => {
  const { controller, time, state, place } = controllerWith(() => []);
  await controller.start();
  expect(place.log).toEqual([]);
  controller.setPlugged(false);
  await settle();
  expect(state.mode).toBe("integrated");
  time.advance(NOTICE_SETTLE_MS);
  expect(place.log).toEqual(["Unplugged, so the graphics card sleeps and the screen runs at 60 Hz to save battery."]);
  controller.choose("hybrid");
  await settle();
  time.advance(NOTICE_QUIET_MS);
  expect(state.mode).toBe("hybrid");
  expect(place.log.length).toBe(1);
  state.fail = true;
  controller.choose("automatic");
  await settle();
  time.advance(NOTICE_QUIET_MS);
  expect(state.mode).toBe("hybrid");
  expect(place.log.length).toBe(1);
  controller.close();
});

test("the controller: the switch after waiting for Steam replaces the waiting notice; plugging back in takes it down", async () => {
  const steam: ProcessFds = { pid: 5900, comm: "steam", links: ["/dev/nvidia0"] };
  let running: ProcessFds[] = [steam];
  const { controller, time, state, place } = controllerWith(() => running);
  await controller.start();
  controller.setPlugged(false);
  await settle();
  expect(place.shown).toBe("waiting");
  running = [];
  await controller.refresh();
  expect(state.mode).toBe("integrated");
  expect(place.log).toEqual(["waiting", "Steam quit, so the graphics card sleeps to save battery."]);

  // Plugged in: said once the quiet time is over.
  controller.setPlugged(true);
  await settle();
  time.advance(NOTICE_QUIET_MS);
  expect(place.shown).toBe("Plugged in, so apps can use the graphics card again, and the screen is back to 120 Hz.");
  // Again, but the cable goes back in before Steam quits.
  running = [steam];
  await controller.refresh();
  controller.setPlugged(false);
  await settle();
  expect(place.shown).toBe("waiting");
  controller.setPlugged(true);
  await settle();
  expect(place.shown).toBeNull();
  expect(place.log.at(-1)).toBe("withdrawn");
  controller.close();
});

test("the notices' one place: the switch replaces the waiting notice in the store, never beside it; its buttons reach the controller", () => {
  const store = new NotificationStore({ schedule: () => () => {} });
  const pressed: string[] = [];
  const place = graphicsNoticePlace(store, { keepHybrid: () => void pressed.push("keep"), openSettings: () => void pressed.push("settings") });
  place.deps.sayWaiting(
    ["Steam"],
    () => void pressed.push("quit"),
    () => {},
  );
  const waiting = store.getSnapshot().live[0];
  expect(waiting?.summary).toBe("Switching to built-in graphics");
  store.invoke(waiting?.id ?? 0, "quit");
  place.deps.sayChanged({
    summary: "Using the built-in graphics",
    body: "Steam quit, so the graphics card sleeps to save battery.",
    actions: [{ key: "use-hybrid", label: "Use Hybrid" }],
  });
  expect(store.getSnapshot().live.map((each) => each.summary)).toEqual(["Using the built-in graphics"]);
  expect(store.getSnapshot().history.map((each) => each.summary)).toEqual(["Using the built-in graphics"]);
  store.invoke(store.getSnapshot().live[0]?.id ?? 0, "use-hybrid");
  place.deps.sayChanged({
    summary: "The graphics card is on",
    body: "Plugged in, so apps can use the graphics card again.",
    actions: [{ key: "settings", label: "Graphics Settings…" }],
  });
  store.invoke(store.getSnapshot().live[0]?.id ?? 0, "settings");
  expect(pressed).toEqual(["quit", "keep", "settings"]);
  // A wait that ends without a switch takes its notice down.
  place.deps.sayWaiting(
    ["Steam"],
    () => {},
    () => {},
  );
  place.deps.withdrawWaiting();
  expect(store.getSnapshot().live).toEqual([]);
  expect(store.getSnapshot().history.length).toBe(1);
  place.close();
});
