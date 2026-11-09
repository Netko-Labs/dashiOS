import { expect, test } from "bun:test";
import type { GraphicsCard } from "../src/graphics/card.ts";
import type { CardwireGpu, CardwireMode, GraphicsBackend } from "../src/graphics/cardwire.ts";
import { GraphicsController } from "../src/graphics/controller.ts";
import type { ProcessFds } from "../src/graphics/holders.ts";
import { decideNotice, type GraphicsChange, type GraphicsNotice, NOTICE_QUIET_MS, NOTICE_SETTLE_MS } from "../src/graphics/notice.ts";
import { graphicsNoticePlace } from "../src/graphics/notice-place.ts";
import { GraphicsTeller } from "../src/graphics/teller.ts";
import { NotificationStore } from "../src/notifications/store.ts";
import type { GraphicsChoice } from "../src/power/modes/settings.ts";
import { settle } from "./fake-bus.ts";

/** Unplugged, no notice before it, the new mode held long enough. */
const unplugged: GraphicsChange = {
  card: true,
  before: "hybrid",
  after: "integrated",
  why: "unplugged",
  held: NOTICE_SETTLE_MS,
  sinceNotice: null,
  waiting: false,
};

test("unplugged: the built-in graphics, why, and Use Hybrid; with the refresh rate in the same notice", () => {
  expect(decideNotice(unplugged)).toEqual({
    say: "notice",
    notice: {
      summary: "Using the built-in graphics",
      body: "Unplugged, so the graphics card sleeps to save battery.",
      actions: [{ key: "use-hybrid", label: "Use Hybrid" }],
    },
  });
  const both = decideNotice({ ...unplugged, rate: "60 Hz" });
  expect(both.say === "notice" && both.notice.body).toBe("Unplugged, so the graphics card sleeps and the screen runs at 60 Hz to save battery.");
});

test("plugged in: the card is on, with Graphics Settings… (its name from the pane list)", () => {
  const plugged: GraphicsChange = { ...unplugged, before: "integrated", after: "hybrid", why: "plugged", sinceNotice: 120_000 };
  expect(decideNotice(plugged)).toEqual({
    say: "notice",
    notice: {
      summary: "The graphics card is on",
      body: "Plugged in, so apps can use the graphics card again.",
      actions: [{ key: "settings", label: "Graphics Settings…" }],
    },
  });
  const both = decideNotice({ ...plugged, rate: "120 Hz" });
  expect(both.say === "notice" && both.notice.body).toBe("Plugged in, so apps can use the graphics card again, and the screen is back to 120 Hz.");
});

test("a screen on the card's port, coming and going, says so", () => {
  const on = decideNotice({ ...unplugged, before: "integrated", after: "hybrid", why: "screen" });
  expect(on.say === "notice" && on.notice.body).toBe("A screen is connected to the graphics card, so the card is on to show it.");
  const off = decideNotice({ ...unplugged, why: "screen-gone" });
  expect(off.say === "notice" && off.notice.body).toBe("The screen on the graphics card was unplugged, so the card sleeps to save battery.");
});

test("a change the person made says nothing, and ends a wait it interrupted", () => {
  expect(decideNotice({ ...unplugged, why: "chosen" })).toEqual({ say: "nothing", withdraw: false });
  expect(decideNotice({ ...unplugged, before: "integrated", after: "hybrid", why: "chosen", waiting: true })).toEqual({ say: "nothing", withdraw: true });
});

test("a switch that waited for apps is said at once, naming them, in place of the waiting notice", () => {
  // Waiting was posted a moment ago and the switch has only just happened: neither wait applies.
  const waited = decideNotice({ ...unplugged, why: "waited", held: 0, sinceNotice: 2000, waiting: true, waitedFor: ["Steam", "Helium"] });
  expect(waited).toEqual({
    say: "notice",
    notice: {
      summary: "Using the built-in graphics",
      body: "Steam and Helium quit, so the graphics card sleeps to save battery.",
      actions: [{ key: "use-hybrid", label: "Use Hybrid" }],
    },
  });
  // Plugged back in while waiting: no switch, and the waiting notice comes down.
  expect(decideNotice({ ...unplugged, after: "hybrid", why: "plugged", waiting: true })).toEqual({ say: "nothing", withdraw: true });
});

test("a failed switch says nothing new, and leaves the waiting notice as it is", () => {
  expect(decideNotice({ ...unplugged, why: "failed", waiting: true })).toEqual({ say: "nothing", withdraw: false });
  expect(decideNotice({ ...unplugged, after: null })).toEqual({ say: "nothing", withdraw: false });
});

test("flapping: a new mode waits until it holds, and notices come at most once in the quiet time", () => {
  expect(decideNotice({ ...unplugged, held: 0 })).toEqual({ say: "later", ms: NOTICE_SETTLE_MS });
  expect(decideNotice({ ...unplugged, held: 4000 })).toEqual({ say: "later", ms: NOTICE_SETTLE_MS - 4000 });
  expect(decideNotice({ ...unplugged, sinceNotice: 10_000 })).toEqual({ say: "later", ms: NOTICE_QUIET_MS - 10_000 });
  // Back to the mode last said: nothing to say.
  expect(decideNotice({ ...unplugged, after: "hybrid", why: "plugged" })).toEqual({ say: "nothing", withdraw: false });
});

test("one GPU, or before Dashi's first decision (login): nothing", () => {
  expect(decideNotice({ ...unplugged, card: false })).toEqual({ say: "nothing", withdraw: false });
  expect(decideNotice({ ...unplugged, before: null })).toEqual({ say: "nothing", withdraw: false });
});

/** A clock and timers the test moves by hand. */
function fakeTime() {
  let now = 0;
  let timers: { at: number; fn: () => void; live: boolean }[] = [];
  return {
    now: () => now,
    later: (fn: () => void, ms: number) => {
      const timer = { at: now + ms, fn, live: true };
      timers.push(timer);
      return () => {
        timer.live = false;
      };
    },
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const next = timers.filter((timer) => timer.live && timer.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        now = next.at;
        next.live = false;
        next.fn();
      }
      timers = timers.filter((timer) => timer.live);
      now = end;
    },
  };
}

test("the teller: a cable wiggled three times in ten seconds gives one notice at most", () => {
  const time = fakeTime();
  const said: GraphicsNotice[] = [];
  const teller = new GraphicsTeller(true, { say: (notice) => void said.push(notice), withdraw: () => {}, now: time.now, later: time.later });
  teller.started("hybrid");
  // Out, in, out, in, out: it ends unplugged, and is said once, when it has held.
  for (const [at, plugged] of [
    [0, false],
    [2000, true],
    [4000, false],
    [7000, true],
    [10_000, false],
  ] as const) {
    time.advance(at - time.now());
    teller.changed(plugged ? "hybrid" : "integrated", plugged ? "plugged" : "unplugged");
  }
  time.advance(NOTICE_SETTLE_MS - 1);
  expect(said).toEqual([]);
  time.advance(1);
  expect(said.map((notice) => notice.summary)).toEqual(["Using the built-in graphics"]);
  // Out and back in within the settle time: nothing at all.
  time.advance(60_000);
  teller.changed("hybrid", "plugged");
  time.advance(1000);
  teller.changed("integrated", "unplugged");
  time.advance(60_000);
  expect(said.length).toBe(1);
  teller.close();
});

test("the teller: a later change waits out the quiet time, then says where it ended", () => {
  const time = fakeTime();
  const said: string[] = [];
  const teller = new GraphicsTeller(true, { say: (notice) => void said.push(notice.summary), withdraw: () => {}, now: time.now, later: time.later });
  teller.started("hybrid");
  teller.changed("integrated", "unplugged");
  time.advance(NOTICE_SETTLE_MS);
  teller.changed("hybrid", "plugged");
  time.advance(NOTICE_SETTLE_MS);
  expect(said).toEqual(["Using the built-in graphics"]);
  time.advance(NOTICE_QUIET_MS);
  expect(said).toEqual(["Using the built-in graphics", "The graphics card is on"]);
  teller.close();
});

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
