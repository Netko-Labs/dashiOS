/** The capsule's layer surface (src/capsule/lib/surface.ts): one host kept with no window, opened and hidden, reopened for another screen or the keyboard. */

import { expect, test } from "bun:test";
import { type NativeHostOptions, type NativeHostTransport, View } from "@mirinjs/metal";
import { CapsuleSurface, capsuleSurface } from "../src/capsule/lib/surface.ts";
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

test("one host with no window; it opens when something shows and hides when nothing does", () => {
  const { log, spawned, spawn } = hosts();
  const surface = new CapsuleSurface({ spawn, element: <View /> });
  expect(spawned).toHaveLength(1);
  expect(spawned[0]?.options.deferred).toBe(true);
  expect(log).toEqual([]);
  surface.show(undefined, false);
  surface.show(undefined, false);
  expect(log).toEqual(["open any none"]);
  expect(surface.shown).toBe(true);
  surface.hide();
  surface.hide();
  expect(log).toEqual(["open any none", "hide"]);
  expect(spawned).toHaveLength(1);
  surface.close();
});

test("another screen, or the keyboard for a card, opens it again", () => {
  const { log, spawn } = hosts();
  const surface = new CapsuleSurface({ spawn, element: <View /> });
  surface.show("eDP-1", false);
  surface.show("eDP-1", true);
  surface.show("DP-2", false);
  expect(log).toEqual(["open eDP-1 none", "hide", "open eDP-1 exclusive", "hide", "open DP-2 none"]);
  surface.close();
});

test("a host that died is replaced, and what was showing shows again", () => {
  const { log, spawned, spawn } = hosts();
  const later: Array<() => void> = [];
  const surface = new CapsuleSurface({ spawn, element: <View />, later: (fn) => later.push(fn) });
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
