import { expect, test } from "bun:test";
import type { CompositorEvent } from "../src/compositor/events.ts";
import { outputsOf } from "../src/compositor/outputs.ts";
import { outputScales, startXwaylandScaling, type XwaylandChoice, xResources, xwaylandScale } from "../src/xwayland-scale.ts";
import { fakeCompositor } from "./support/compositor.ts";
import { settle } from "./support/time.ts";

test("Xwayland takes the largest screen scale, never below 1", () => {
  expect(xwaylandScale([1, 1.75])).toBe(1.75);
  expect(xwaylandScale([])).toBe(1);
  expect(xwaylandScale([0.5, Number.NaN])).toBe(1);
  expect(outputScales(outputsOf({ outputs: [{ name: "a", scale: 2 }, { name: "b", scale: 3, enabled: false }, { scale: 4 }, { name: "x" }] }))).toEqual([2, 1]);
  expect(outputScales([])).toEqual([]);
});

test("X resources say the dpi and cursor size for the scale", () => {
  expect(xResources(1.75)).toBe("Xft.dpi:\t168\nXcursor.size:\t42\n");
  expect(xResources(1)).toBe("Xft.dpi:\t96\nXcursor.size:\t24\n");
  expect(xResources(1.5, 32)).toBe("Xft.dpi:\t144\nXcursor.size:\t48\n");
});

test("the scale goes to the compositor, and the resources once Xwayland is ready, again when it restarts", async () => {
  const requests: [string, unknown][] = [];
  const merged: string[] = [];
  const events: { send?: (event: CompositorEvent) => void } = {};
  let xwayland: "starting" | "ready" = "starting";
  const compositor = fakeCompositor(
    async (method, params) => {
      requests.push([method, params]);
      if (method === "session") return { waylandDisplay: "wayland-1", display: ":0", xwayland, pointer: null, locked: false };
      return method === "outputs" ? { outputs: [{ name: "eDP-1", scale: 1.5 }] } : {};
    },
    {
      on: (handler: (event: CompositorEvent) => void) => {
        events.send = handler;
        return () => {};
      },
    },
  );
  const choice: XwaylandChoice = { scaling: "sharp", pointerSize: 24 };
  const scaling = startXwaylandScaling({
    compositor,
    mergeResources: async (display, resources) => {
      merged.push(`${display} ${resources}`);
      return true;
    },
    choice: () => choice,
  });
  await settle();
  expect(requests).toContainEqual(["xwayland-scale", { scale: 1.5 }]);
  expect(merged).toEqual([]);
  xwayland = "ready";
  events.send?.({ event: "session-changed" });
  await settle();
  expect(merged).toEqual([":0 Xft.dpi:\t144\nXcursor.size:\t36\n"]);
  // Same screens: nothing new to tell X11 apps.
  events.send?.({ event: "outputs-changed" });
  await settle();
  expect(merged).toHaveLength(1);
  // Xwayland restarted: its resources are gone, so they go again.
  events.send?.({ event: "session-changed" });
  await settle();
  expect(merged).toHaveLength(2);
  // A bigger pointer: the same scale, a new cursor size.
  choice.pointerSize = 32;
  scaling.refresh();
  await settle();
  expect(merged.at(-1)).toBe(":0 Xft.dpi:\t144\nXcursor.size:\t48\n");
  // Stretched: Xwayland back at 1, X11 apps told 96 dpi.
  choice.scaling = "stretched";
  scaling.refresh();
  await settle();
  expect(requests.filter(([method]) => method === "xwayland-scale").at(-1)).toEqual(["xwayland-scale", { scale: 1 }]);
  expect(merged.at(-1)).toBe(":0 Xft.dpi:\t96\nXcursor.size:\t32\n");
  scaling.stop();
});
