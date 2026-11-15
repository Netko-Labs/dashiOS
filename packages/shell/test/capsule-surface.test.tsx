/** The capsule's layer surface (src/capsule/lib/surface.ts): one host kept with no window, opened and hidden, reopened for another screen or the keyboard. */

import { expect, test } from "bun:test";
import { type NativeHostOptions, type NativeHostTransport, View } from "@mirinjs/metal";
import { CapsuleSurface, capsuleSurface, LINGER_MS } from "../src/capsule/lib/surface.ts";
import { osdSurface } from "../src/system/lib/osd-panel.tsx";

function hosts() {
  const log: string[] = [];
  const spawned: Array<{ options: NativeHostOptions; die(): void }> = [];
  const spawn = (options: NativeHostOptions): NativeHostTransport => {
    const closers: Array<() => void> = [];
    spawned.push({
      options,
      die: () => {
        for (const close of closers) close();
      },
    });
    return {
      send() {},
      onEvent() {},
      onClose: (listener) => void closers.push(listener),
      simulate() {},
      onToplevel() {},
      toplevel() {},
      unlock() {},
      setTitle() {},
      setSize() {},
      setMinSize() {},
      setTextAntialiasing: () => false,
      open: (window) => {
        const surface: { output?: string; keyboard?: string } = window.surface ?? {};
        log.push(`open ${surface.output ?? "any"} ${surface.keyboard}`);
      },
      hide: () => void log.push("hide"),
      close: () => void log.push("close"),
    };
  };
  return { log, spawned, spawn };
}

test("it takes no keyboard, lies over everything along the bottom edge, and is named for input-origin", () => {
  expect(capsuleSurface(undefined, false)).toEqual({
    layer: "overlay",
    anchor: ["bottom", "left", "right"],
    exclusiveZone: -1,
    keyboard: "none",
    namespace: "dashi.capsule",
  });
  expect(capsuleSurface("DP-2", true)).toMatchObject({ keyboard: "exclusive", output: "DP-2" });
});

/** A surface on a clock moved by hand. */
function timed(lingerMs = 0) {
  const { log, spawned, spawn } = hosts();
  let clock = 0;
  let later: Array<{ at: number; fn: () => void }> = [];
  const advance = (ms: number): void => {
    clock += ms;
    for (;;) {
      const due = later.find((each) => each.at <= clock);
      if (!due) return;
      later = later.filter((each) => each !== due);
      due.fn();
    }
  };
  const surface = new CapsuleSurface({ spawn, element: <View />, lingerMs, now: () => clock, later: (fn, ms) => later.push({ at: clock + ms, fn }) });
  return { log, spawned, surface, advance };
}

test("one host with no window; it opens when something shows and hides when nothing does", () => {
  const { log, spawned, surface, advance } = timed();
  expect(spawned).toHaveLength(1);
  expect(spawned[0]?.options.deferred).toBe(true);
  expect(log).toEqual([]);
  surface.show(undefined, false);
  surface.show(undefined, false);
  expect(log).toEqual(["open any none"]);
  expect(surface.shown).toBe(true);
  advance(1);
  surface.hide();
  surface.hide();
  expect(log).toEqual(["open any none", "hide"]);
  expect(spawned).toHaveLength(1);
  surface.close();
});

// The host needs no time between the two (mirin PR 37): a key that was a chord after all shows and hides at once.
test("it hides in the breath it opened, and opens in the breath it hid", () => {
  const { log, surface } = timed();
  surface.show(undefined, false);
  surface.hide();
  surface.show(undefined, false);
  surface.hide();
  expect(log).toEqual(["open any none", "hide", "open any none", "hide"]);
  surface.close();
});

test("another screen, or the keyboard for a card, opens it again at once", () => {
  const { log, surface } = timed();
  surface.show("eDP-1", false);
  surface.show("eDP-1", true);
  expect(log).toEqual(["open eDP-1 none", "hide", "open eDP-1 exclusive"]);
  surface.show("DP-2", false);
  expect(log.slice(3)).toEqual(["hide", "open DP-2 none"]);
  surface.close();
});

test("a host that died is replaced, and what was showing shows again", () => {
  const { log, spawned, spawn } = hosts();
  const later: Array<() => void> = [];
  const surface = new CapsuleSurface({ spawn, element: <View />, later: (fn) => later.push(fn), now: () => 0 });
  surface.show(undefined, false);
  spawned[0]?.die();
  expect(surface.shown).toBe(false);
  later[0]?.();
  expect(spawned).toHaveLength(2);
  // Unmounting the dead host's tree closes its transport.
  expect(log.filter((line) => line !== "close")).toEqual(["open any none", "open any none"]);
  surface.close();
  spawned[1]?.die();
  expect(later).toHaveLength(1);
});

test("the volume indicator is small and above the capsule while one is up, and the square otherwise", () => {
  expect(osdSurface(null)).toMatchObject({ small: false, surface: { margin: { bottom: 36 } } });
  const small = osdSurface({ top: 111, output: "DP-2" });
  expect(small).toMatchObject({ small: true, height: 55, surface: { exclusiveZone: -1, margin: { bottom: 107 }, output: "DP-2" } });
  // Its row starts above the capsule's top: 107 + the surface's own margin of 12 = 119 > 111.
  expect(107 + 12).toBeGreaterThan(111);
});

test("one line replaces another: the window lingers, so it never hides in between", () => {
  const { log, surface, advance } = timed(LINGER_MS);
  surface.show(undefined, false);
  advance(2000);
  // Nothing shows for a moment (heard, then the step), then the next line: the same window, never hidden.
  surface.hide();
  advance(LINGER_MS - 1);
  surface.show(undefined, false);
  advance(5000);
  expect(log).toEqual(["open any none"]);
  // Nothing more comes: it hides once it has lingered.
  surface.hide();
  advance(LINGER_MS - 1);
  expect(log).toEqual(["open any none"]);
  advance(1);
  expect(log).toEqual(["open any none", "hide"]);
  surface.close();
});
