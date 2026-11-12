import { describe, expect, test } from "bun:test";

import { parseEvent, parseGpus, parseWindow, parseWindowIcon } from "../src/compositor/client.ts";

const window = {
  id: 3,
  appId: "foot",
  title: "foot",
  pid: 42,
  focused: true,
  state: "normal",
};

describe("window icons", () => {
  test("a theme name, a picture, or both", () => {
    expect(parseWindowIcon({ name: "foot", path: null })).toEqual({
      name: "foot",
      path: null,
    });
    expect(
      parseWindowIcon({
        name: null,
        path: "/run/user/1000/dashi-comp-icons/3.png",
      }),
    ).toEqual({
      name: null,
      path: "/run/user/1000/dashi-comp-icons/3.png",
    });
    expect(parseWindowIcon({ name: "", path: 7 })).toBeNull();
    expect(parseWindowIcon(null)).toBeNull();
  });

  test("a window carries its icon only when it has one", () => {
    expect(parseWindow({ ...window, icon: { name: "foot", path: null } })?.icon).toEqual({ name: "foot", path: null });
    expect(parseWindow({ ...window, icon: null })).not.toHaveProperty("icon");
  });

  test("window-icon tells a change, including back to none", () => {
    expect(parseEvent({ event: "window-icon", window: 3, name: "foot", path: null })).toEqual({
      event: "window-icon",
      window: 3,
      icon: { name: "foot", path: null },
    });
    expect(parseEvent({ event: "window-icon", window: 3, name: null, path: null })).toEqual({
      event: "window-icon",
      window: 3,
      icon: { name: null, path: null },
    });
    expect(parseEvent({ event: "window-icon", window: "3" })).toBeNull();
  });
});

test("the bell names a window or none", () => {
  expect(parseEvent({ event: "bell", window: 3 })).toEqual({
    event: "bell",
    window: 3,
  });
  expect(parseEvent({ event: "bell", window: null })).toEqual({
    event: "bell",
    window: null,
  });
  expect(parseEvent({ event: "bell" })).toBeNull();
});

test("X11 windows say so", () => {
  expect(parseWindow({ ...window, x11: true })?.x11).toBe(true);
  expect(parseWindow({ ...window, x11: false })).not.toHaveProperty("x11");
});

test("an edge hold names its edge, screen, and window", () => {
  const hold = { event: "edge-hold", edge: "left", output: "eDP-1", window: 4, count: 2, preview: true } as const;
  expect(parseEvent(hold)).toEqual(hold);
  expect(parseEvent({ ...hold, preview: undefined })).toEqual({ ...hold, preview: false });
  expect(parseEvent({ ...hold, edge: "middle" })).toBeNull();
  expect(parseEvent({ ...hold, window: "4" })).toBeNull();
});

test("an overview drag says which window and where", () => {
  expect(parseEvent({ event: "overview-drag", window: 4, x: 10, y: 20 })).toEqual({ event: "overview-drag", window: 4, x: 10, y: 20 });
  expect(parseEvent({ event: "overview-drag", window: 4 })).toBeNull();
});

test("a window's ext-foreign-toplevel-list identifier comes along", () => {
  expect(parseWindow({ ...window, toplevel: "a1b2" })?.toplevel).toBe("a1b2");
  expect(parseWindow({ ...window, toplevel: "" })).not.toHaveProperty("toplevel");
  expect(parseWindow({ ...window, toplevel: 7 })).not.toHaveProperty("toplevel");
});

test("GPUs say whether dashi-comp holds them open, and for what", () => {
  expect(parseEvent({ event: "gpus-changed" })).toEqual({ event: "gpus-changed" });
  expect(
    parseGpus({
      gpus: [
        { card: "card0", open: false, draws: false, kept: false, screens: [], buffers: 0 },
        { card: "card1", open: true, draws: true, kept: false, screens: ["eDP-1", 3], buffers: 0 },
        { open: true },
      ],
    }),
  ).toEqual([
    { card: "card0", open: false, draws: false, kept: false, screens: [], buffers: 0 },
    { card: "card1", open: true, draws: true, kept: false, screens: ["eDP-1"], buffers: 0 },
  ]);
  expect(parseGpus({ gpus: "no" })).toEqual([]);
  expect(parseGpus(null)).toEqual([]);
});
