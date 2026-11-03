import { expect, test } from "bun:test";
import type { CompositorEvent } from "../src/compositor.ts";
import { outputScales, startXwaylandScaling, xResources, xwaylandScale } from "../src/xwayland-scale.ts";

test("Xwayland takes the largest screen scale, never below 1", () => {
  expect(xwaylandScale([1, 1.75])).toBe(1.75);
  expect(xwaylandScale([])).toBe(1);
  expect(xwaylandScale([0.5, Number.NaN])).toBe(1);
  expect(outputScales({ outputs: [{ scale: 2 }, { scale: 3, enabled: false }, { name: "x" }] })).toEqual([2]);
  expect(outputScales(null)).toEqual([]);
});

test("X resources say the dpi and cursor size for the scale", () => {
  expect(xResources(1.75)).toBe("Xft.dpi:\t168\nXcursor.size:\t42\n");
  expect(xResources(1)).toBe("Xft.dpi:\t96\nXcursor.size:\t24\n");
});

test("the scale goes to the compositor, and the resources once Xwayland is ready, again when it restarts", async () => {
  const requests: [string, unknown][] = [];
  const merged: string[] = [];
  const events: { send?: (event: CompositorEvent) => void } = {};
  let xwayland: "starting" | "ready" = "starting";
  const compositor = {
    request: async (method: string, params?: unknown) => {
      requests.push([method, params]);
      return method === "outputs" ? { outputs: [{ scale: 1.5 }] } : {};
    },
    session: async () => ({ waylandDisplay: "wayland-1", display: ":0", xwayland, pointer: null }),
    on: (handler: (event: CompositorEvent) => void) => {
      events.send = handler;
      return () => {};
    },
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 5));
  startXwaylandScaling({
    compositor: compositor as never,
    mergeResources: async (display, resources) => {
      merged.push(`${display} ${resources}`);
      return true;
    },
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
});
