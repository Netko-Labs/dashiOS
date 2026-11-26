/**
 * Focus for a while (control-center/focus.ts; design.html CC-6, D785): when each choice ends, the words the
 * page says, Focus turning itself off when its time comes, and the flags keeping the end across a restart.
 * And Now Playing's words and cover (CC-7, lib/snapshot.ts `nowPlaying`).
 */

import { describe, expect, test } from "bun:test";
import { isThere, tileState } from "../src/control-center/catalog.ts";
import { chooseFocus, focusChoices, focusChosen, focusDetail, focusUntil, keepFocusTime } from "../src/control-center/focus.ts";
import { nowPlaying } from "../src/control-center/lib/snapshot.ts";
import { FlagsStore, parseFlags } from "../src/shared/control-center/index.ts";

const AFTERNOON = new Date(2026, 10, 26, 16, 48);
const LATE = new Date(2026, 10, 26, 18, 30);
const PREFS = { locale: "en-US", hour24: false, showDate: true } as const;

describe("the choices", () => {
  test("an hour from now, 7 PM today, 8 AM tomorrow, or until turned off", () => {
    expect(focusUntil("hour", AFTERNOON)).toBe(new Date(2026, 10, 26, 17, 48).getTime());
    expect(focusUntil("evening", AFTERNOON)).toBe(new Date(2026, 10, 26, 19, 0).getTime());
    expect(focusUntil("tomorrow", AFTERNOON)).toBe(new Date(2026, 10, 27, 8, 0).getTime());
    expect(focusUntil("off", AFTERNOON)).toBeNull();
    expect(focusChoices(AFTERNOON).map((choice) => choice.label)).toEqual(["For 1 hour", "Until this evening", "Until tomorrow", "Until I turn it off"]);
  });

  test("this evening is offered only while an hour of the day is left before it", () => {
    expect(focusChoices(LATE).map((choice) => choice.id)).toEqual(["hour", "tomorrow", "off"]);
  });

  test("the header says how long; the chosen row is the one it was turned on for", () => {
    expect(focusDetail({ dnd: false })).toBe("Off");
    expect(focusDetail({ dnd: true })).toBe("On");
    expect(focusDetail({ dnd: true, dndUntil: 1, dndFor: "hour" })).toBe("On for 1 hour");
    expect(focusDetail({ dnd: true, dndUntil: new Date(2026, 10, 26, 19, 0).getTime(), dndFor: "evening" }, PREFS)).toBe("Until 7:00 PM");
    expect(focusChosen({ dnd: false })).toBeNull();
    expect(focusChosen({ dnd: true })).toBe("off");
    expect(focusChosen({ dnd: true, dndFor: "tomorrow" })).toBe("tomorrow");
  });
});

describe("the flags", () => {
  test("Focus for a while keeps its end; off, or the switch turned by hand, forgets it", () => {
    const flags = new FlagsStore(null);
    chooseFocus(flags, "hour", AFTERNOON);
    expect(flags.getSnapshot()).toMatchObject({ dnd: true, dndFor: "hour", dndUntil: focusUntil("hour", AFTERNOON) });
    chooseFocus(flags, "off", AFTERNOON);
    expect(flags.getSnapshot().dndUntil).toBeUndefined();
    chooseFocus(flags, "evening", AFTERNOON);
    flags.toggle("dnd");
    expect(flags.getSnapshot()).toMatchObject({ dnd: false });
    expect(flags.getSnapshot().dndFor).toBeUndefined();
    flags.toggle("dnd");
    expect(flags.getSnapshot().dndUntil).toBeUndefined();
  });

  test("the end is read back from the file, only with Focus on and a known choice", () => {
    expect(parseFlags('{"dnd":true,"dndUntil":5,"dndFor":"hour"}')).toMatchObject({ dnd: true, dndUntil: 5, dndFor: "hour" });
    expect(parseFlags('{"dnd":false,"dndUntil":5,"dndFor":"hour"}').dndUntil).toBeUndefined();
    expect(parseFlags('{"dnd":true,"dndUntil":5,"dndFor":"week"}').dndUntil).toBeUndefined();
  });

  test("Focus turns itself off when its time comes, and at once when it already passed", () => {
    const flags = new FlagsStore(null);
    let now = AFTERNOON.getTime();
    const timers: { at: number; fn: () => void; live: boolean }[] = [];
    const clock = {
      now: () => now,
      later: (fn: () => void, ms: number) => {
        const timer = { at: now + ms, fn, live: true };
        timers.push(timer);
        return () => void (timer.live = false);
      },
    };
    const stop = keepFocusTime(flags, clock);
    chooseFocus(flags, "hour", AFTERNOON);
    const armed = timers.filter((timer) => timer.live);
    expect(armed.map((timer) => timer.at)).toEqual([focusUntil("hour", AFTERNOON) as number]);
    now = armed[0]?.at ?? now;
    armed[0]?.fn();
    expect(flags.getSnapshot().dnd).toBe(false);
    stop();
    // Started after its end (a restart): off at once.
    const late = new FlagsStore(null);
    late.set({ dnd: true, dndUntil: now - 1, dndFor: "hour" });
    keepFocusTime(late, clock)();
    expect(late.getSnapshot().dnd).toBe(false);
  });
});

describe("Now Playing (CC-7)", () => {
  test("the title, the artist and the player; a cover only as a local file; no player, no tile", () => {
    const playing = { title: "Slow Tide", artist: "Harbour Lights", name: "Helium", playing: true, art: "file:///home/alexk/.cache/cover%201.png" };
    expect(nowPlaying(playing)).toEqual({ title: "Slow Tide", detail: "Harbour Lights · Helium", playing: true, cover: "/home/alexk/.cache/cover 1.png" });
    expect(nowPlaying({ ...playing, artist: "", art: "https://example.com/c.png" })).toMatchObject({ detail: "Helium", cover: null });
    expect(nowPlaying(null)).toBeNull();
  });
});

test("the Now Playing tile is there only while a player plays", () => {
  const base = { playing: null } as Parameters<typeof isThere>[1];
  expect(isThere("nowplaying", base)).toBe(false);
  const snap = { ...base, playing: { title: "Slow Tide", detail: "Helium", playing: false, cover: null } };
  expect(isThere("nowplaying", snap)).toBe(true);
  expect(tileState("nowplaying", snap)).toMatchObject({ title: "Slow Tide", detail: "Helium", on: false });
});
