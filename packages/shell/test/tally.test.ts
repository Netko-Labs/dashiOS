import { describe, expect, test } from "bun:test";
import { type OnAirItem, type TallyClock, TallyStore } from "../src/tally/index.ts";

const MIN = 60_000;

/** A clock the test moves by hand; due wakes run as time passes them. */
function fakeClock() {
  let now = 1_000_000;
  let wakes: { at: number; run: () => void }[] = [];
  const clock: TallyClock = {
    now: () => now,
    at: (at, run) => {
      const wake = { at, run };
      wakes.push(wake);
      return () => {
        wakes = wakes.filter((w) => w !== wake);
      };
    },
  };
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const next = wakes.filter((w) => w.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      wakes = wakes.filter((w) => w !== next);
      now = next.at;
      next.run();
    }
    now = end;
  };
  return { clock, advance, now: () => now };
}

const item = (key: string, reason: OnAirItem["reason"], since: number, extra: Partial<OnAirItem> = {}): OnAirItem => ({
  key,
  reason,
  since,
  label: key,
  glyph: "timer",
  ink: null,
  ...extra,
});

describe("the tally's cut rules", () => {
  test("nothing live: nothing on air, house lights up", () => {
    const store = new TallyStore(fakeClock().clock);
    expect(store.get().holder).toBeNull();
    expect(store.get().houseDown).toBe(false);
  });

  test("one holder for the system; the rest are on standby, newest first", () => {
    const t = fakeClock();
    const store = new TallyStore(t.clock);
    store.set("run", [item("run", "running", t.now() - 5000)]);
    store.set("dl", [item("dl", "running", t.now() - 9000)]);
    store.set("timer", [item("timer", "running", t.now())]);
    expect(store.get().holder).toBe("run");
    t.advance(MIN);
    store.set("timer", [item("timer", "running", t.now())]);
    // The newest running item wins once the minute's hold is over…
    expect(store.get().holder).toBe("timer");
    expect(store.get().standby.map((i) => i.key)).toEqual(["run", "dl"]);
  });

  test("a holder keeps it at least 60 s, then due beats running; house lights snap down", () => {
    const t = fakeClock();
    const store = new TallyStore(t.clock);
    store.set("timer", [item("timer", "running", t.now())]);
    t.advance(10_000);
    store.set("cal", [item("cal", "due", t.now(), { deadline: t.now() + 3 * MIN })]);
    expect(store.get().holder).toBe("timer");
    expect(store.get().houseDown).toBe(false);
    t.advance(50_000);
    expect(store.get().holder).toBe("cal");
    expect(store.get().houseDown).toBe(true);
  });

  test("only something critical cuts inside the hold", () => {
    const t = fakeClock();
    const store = new TallyStore(t.clock);
    store.set("timer", [item("timer", "running", t.now())]);
    t.advance(5000);
    store.set("move", [item("move", "asks", t.now(), { critical: false })]);
    expect(store.get().holder).toBe("timer");
    store.set("send", [item("send", "asks", t.now(), { critical: true })]);
    expect(store.get().holder).toBe("send");
    expect(store.get().houseDown).toBe(true);
  });

  test("a question that is not critical never asks: it counts as running", () => {
    const t = fakeClock();
    const store = new TallyStore(t.clock);
    store.set("cal", [item("cal", "due", t.now(), { deadline: t.now() + MIN })]);
    t.advance(2 * 60_000 - 1);
    store.set("move", [item("move", "asks", t.now(), { critical: false })]);
    expect(store.get().holder).toBe("cal");
  });

  test("between two due items the earlier deadline wins, not the newer", () => {
    const t = fakeClock();
    const store = new TallyStore(t.clock);
    store.set("a", [item("a", "due", t.now(), { deadline: t.now() + 4 * MIN })]);
    store.set("b", [item("b", "due", t.now() + 1, { deadline: t.now() + 2 * MIN })]);
    // Inside the minute's hold "a" keeps it; then the earlier deadline takes it.
    expect(store.get().holder).toBe("a");
    t.advance(MIN);
    expect(store.get().holder).toBe("b");
  });

  test("an item that lost it cannot retake it for 10 minutes while another could hold", () => {
    const t = fakeClock();
    const store = new TallyStore(t.clock);
    store.set("music", [item("music", "running", t.now())]);
    t.advance(MIN);
    store.set("dl", [item("dl", "running", t.now())]);
    expect(store.get().holder).toBe("dl");
    // music starts a new track (newer), but it lost the tally less than 10 minutes ago.
    t.advance(2 * MIN);
    store.set("music", [item("music", "running", t.now())]);
    expect(store.get().holder).toBe("dl");
    t.advance(8 * MIN);
    store.set("music", [item("music", "running", t.now())]);
    expect(store.get().holder).toBe("music");
  });

  test("a loser that becomes more urgent may retake: a running timer reaching zero", () => {
    const t = fakeClock();
    const store = new TallyStore(t.clock);
    store.set("timer", [item("timer", "running", t.now())]);
    t.advance(MIN);
    store.set("dl", [item("dl", "running", t.now())]);
    expect(store.get().holder).toBe("dl");
    t.advance(2 * MIN);
    store.set("timer", [item("timer", "due", t.now(), { deadline: t.now() })]);
    expect(store.get().holder).toBe("timer");
  });

  test("a due item holds at most 2 minutes unanswered; house lights at most 2 minutes", () => {
    const t = fakeClock();
    const store = new TallyStore(t.clock);
    store.set("dl", [item("dl", "running", t.now() - 20 * MIN)]);
    t.advance(MIN);
    store.set("timer", [item("timer", "due", t.now(), { deadline: t.now() })]);
    expect(store.get().holder).toBe("timer");
    expect(store.get().houseDown).toBe(true);
    t.advance(2 * MIN);
    // Spent: it goes to its notification; the house lights come up and the download holds again.
    expect(store.get().houseDown).toBe(false);
    expect(store.get().holder).toBe("dl");
    expect(store.get().standby.map((i) => i.key)).toEqual([]);
  });

  test("house lights stay up for things that only run", () => {
    const t = fakeClock();
    const store = new TallyStore(t.clock);
    store.set("music", [item("music", "running", t.now())]);
    expect(store.get().houseDown).toBe(false);
  });

  test("a pin beats due and running at once, loses to asking, and comes back after", () => {
    const t = fakeClock();
    const store = new TallyStore(t.clock);
    store.set("music", [item("music", "running", t.now())]);
    t.advance(MIN);
    store.set("dl", [item("dl", "running", t.now())]);
    expect(store.get().holder).toBe("dl");
    store.pin("music");
    expect(store.get().holder).toBe("music");
    store.set("cal", [item("cal", "due", t.now(), { deadline: t.now() + MIN })]);
    t.advance(MIN);
    expect(store.get().holder).toBe("music");
    store.set("send", [item("send", "asks", t.now(), { critical: true })]);
    expect(store.get().holder).toBe("send");
    t.advance(5000);
    store.set("send", []);
    expect(store.get().holder).toBe("music");
    expect(store.get().pinned).toBe("music");
  });

  test("a pin ends with its item", () => {
    const t = fakeClock();
    const store = new TallyStore(t.clock);
    store.set("music", [item("music", "running", t.now())]);
    store.pin("music");
    store.set("music", []);
    expect(store.get().pinned).toBeNull();
    expect(store.get().holder).toBeNull();
  });

  test("listeners hear only real changes", () => {
    const t = fakeClock();
    const store = new TallyStore(t.clock);
    let heard = 0;
    store.subscribe(() => heard++);
    const music = [item("music", "running", t.now())];
    store.set("music", music);
    store.set("music", music);
    expect(heard).toBe(1);
  });
});
