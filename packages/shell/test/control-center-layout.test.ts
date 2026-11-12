/**
 * Control Center's grid as data (control-center/layout.ts): the default
 * layout packs as the approved design draws it, a removed tile leaves no
 * gap, a missing control comes back where it was, sizes cycle, drags and
 * ⌥-arrows move tiles, the arrows find the tile that way, and the saved
 * layout is read as untrusted.
 */

import { expect, test } from "bun:test";
import { DEFAULT_LAYOUT } from "../src/control-center/catalog.ts";
import {
  addItem,
  frameOf,
  GRID,
  gridHeight,
  type Layout,
  moveItem,
  moveToward,
  neighbor,
  nextSize,
  pack,
  parseLayout,
  removeItem,
  serializeLayout,
  shown,
  tileAt,
} from "../src/control-center/layout.ts";

const at = (layout: Layout, isThere: (id: string) => boolean = (id) => id !== "ethernet") =>
  pack(shown(layout, isThere)).map(({ id, col, row, cols, rows }) => `${id} ${col},${row} ${cols}x${rows}`);

test("the default layout on a laptop packs as drawn: Wi-Fi and the sliders, Bluetooth, Focus and Dark, Power and Keyboard, the battery", () => {
  expect(at(DEFAULT_LAYOUT)).toEqual([
    "wifi 0,0 2x1",
    "brightness 2,0 1x3",
    "volume 3,0 1x3",
    "bluetooth 0,1 2x1",
    "focus 0,2 1x1",
    "dark 1,2 1x1",
    "power 0,3 2x1",
    "keyboard 2,3 2x1",
    "battery 0,4 4x1",
  ]);
  // Five rows of 56 with 8 between, inside 12 of padding: the 344 × 336 panel.
  const placed = pack(shown(DEFAULT_LAYOUT, (id) => id !== "ethernet"));
  expect(gridHeight(placed) + 2 * GRID.padding).toBe(336);
  expect(frameOf({ col: 2, row: 0, cols: 1, rows: 3 })).toEqual({ left: 164, top: 0, width: 74, height: 184 });
});

test("a machine without Wi-Fi shows Ethernet in its place; one without a battery or a keyboard light just closes up", () => {
  const desktop = (id: string) => !["wifi", "power", "keyboard", "battery"].includes(id);
  expect(at(DEFAULT_LAYOUT, desktop)).toEqual([
    "ethernet 0,0 2x1",
    "brightness 2,0 1x3",
    "volume 3,0 1x3",
    "bluetooth 0,1 2x1",
    "focus 0,2 1x1",
    "dark 1,2 1x1",
  ]);
});

test("a removed tile leaves no gap: the next ones move up into it", () => {
  const layout = removeItem(DEFAULT_LAYOUT, "bluetooth");
  expect(at(layout).slice(3, 6)).toEqual(["focus 0,1 1x1", "dark 1,1 1x1", "power 0,2 2x1"]);
});

test("a control that goes missing keeps its place in the order and comes back there", () => {
  const without = at(DEFAULT_LAYOUT, (id) => id !== "ethernet" && id !== "bluetooth");
  expect(without).not.toContain("bluetooth 0,1 2x1");
  expect(at(DEFAULT_LAYOUT)).toContain("bluetooth 0,1 2x1");
});

test("adding goes to the end in the control's first size; adding twice does nothing", () => {
  const layout = addItem(DEFAULT_LAYOUT, "lock", "round");
  expect(layout.at(-1)).toEqual({ id: "lock", size: "round" });
  expect(addItem(layout, "lock", "wide")).toBe(layout);
  // The battery fills row 4; a round tile goes on the next row.
  expect(at(layout).at(-1)).toBe("lock 0,5 1x1");
});

test("a click switches round and wide, tall and flat; a control with one size keeps it", () => {
  const wide = nextSize(DEFAULT_LAYOUT, "focus", ["round", "wide"]);
  expect(wide.find((item) => item.id === "focus")?.size).toBe("wide");
  expect(nextSize(wide, "focus", ["round", "wide"]).find((item) => item.id === "focus")?.size).toBe("round");
  expect(nextSize(DEFAULT_LAYOUT, "volume", ["tall", "flat"]).find((item) => item.id === "volume")?.size).toBe("flat");
  expect(nextSize(DEFAULT_LAYOUT, "battery", ["flat"])).toEqual(DEFAULT_LAYOUT);
  // A flat volume lies across the grid, under what fits beside the standing brightness.
  expect(at(nextSize(DEFAULT_LAYOUT, "volume", ["tall", "flat"]))).toContain("volume 0,3 4x1");
});

test("dragging over a tile takes its place, either way; hidden tiles stay where they were", () => {
  const ids = (layout: Layout) => layout.map((item) => item.id);
  expect(ids(moveItem(DEFAULT_LAYOUT, "focus", "dark")).slice(5, 7)).toEqual(["dark", "focus"]);
  expect(ids(moveItem(DEFAULT_LAYOUT, "dark", "wifi")).slice(0, 3)).toEqual(["dark", "wifi", "ethernet"]);
  expect(moveItem(DEFAULT_LAYOUT, "dark", "nothing")).toBe(DEFAULT_LAYOUT);
});

test("the arrows go to the nearest tile that way, overlapping first; ⌥ and an arrow trade places", () => {
  const placed = pack(shown(DEFAULT_LAYOUT, (id) => id !== "ethernet"));
  expect(neighbor(placed, "wifi", "right")).toBe("brightness");
  expect(neighbor(placed, "brightness", "right")).toBe("volume");
  expect(neighbor(placed, "wifi", "down")).toBe("bluetooth");
  expect(neighbor(placed, "dark", "right")).toBe("brightness");
  expect(neighbor(placed, "keyboard", "down")).toBe("battery");
  expect(neighbor(placed, "battery", "down")).toBeNull();
  expect(neighbor(placed, "wifi", "left")).toBeNull();
  expect(neighbor(placed, "missing", "down")).toBe("wifi");
  const traded = moveToward(DEFAULT_LAYOUT, placed, "focus", "right");
  expect(at(traded).slice(4, 6)).toEqual(["dark 0,2 1x1", "focus 1,2 1x1"]);
});

test("a point in the grid names the tile under it, or none between tiles", () => {
  const placed = pack(shown(DEFAULT_LAYOUT, (id) => id !== "ethernet"));
  expect(tileAt(placed, 10, 10)).toBe("wifi");
  expect(tileAt(placed, 170, 150)).toBe("brightness");
  expect(tileAt(placed, 158, 10)).toBeNull();
});

test("the saved layout round-trips; bad entries, repeats and unknown sizes are left out", () => {
  expect(parseLayout(JSON.parse(serializeLayout(DEFAULT_LAYOUT)))).toEqual(DEFAULT_LAYOUT);
  expect(
    parseLayout({
      items: [
        { id: "wifi", size: "wide" },
        { id: "wifi", size: "round" },
        { id: "x", size: "huge" },
        { id: "../etc", size: "round" },
        null,
        { id: "dark", size: "round" },
      ],
    }),
  ).toEqual([
    { id: "wifi", size: "wide" },
    { id: "dark", size: "round" },
  ]);
  expect(parseLayout("nope")).toBeNull();
  expect(parseLayout({ items: [{ id: "applet:dev.netko.asus-control/lid", size: "wide" }] })).toEqual([
    { id: "applet:dev.netko.asus-control/lid", size: "wide" },
  ]);
});
