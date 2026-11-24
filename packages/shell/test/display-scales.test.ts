import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DisplayStore, type PortScales, ScreenScales } from "../src/display-config/index.ts";
import { parseScales } from "../src/display-config/saved.ts";
import { initialScale, type ScreenInfo } from "../src/displays.ts";

const samsung = { name: "HDMI-A-1", make: "Samsung Electric Company", model: "LS40BM", serial: "H4ZT600123" };
const other = { name: "HDMI-A-1", make: "LG Electronics", model: "OLED42C2", serial: "" };

function ports(initial: Record<string, number> = {}): PortScales & { held: Record<string, number> } {
  const held = { ...initial };
  return {
    held,
    displayScale: (name) => held[name],
    setDisplayScale: (name, scale) => {
      if (scale === undefined) delete held[name];
      else held[name] = scale;
    },
  };
}

test("a chosen scale follows the monitor to another port, and another monitor on that port gets its own", () => {
  const scales = new ScreenScales(new DisplayStore({ path: null }), ports());
  scales.remember(samsung, 1.25);
  expect(scales.of(samsung)).toBe(1.25);
  expect(scales.of({ ...samsung, name: "DP-2" })).toBe(1.25);
  expect(scales.of(other)).toBeUndefined();
});

test("a scale kept by port (before 0.10) is taken over by the first monitor seen there", () => {
  const byPort = ports({ "HDMI-A-1": 1.5 });
  const scales = new ScreenScales(new DisplayStore({ path: null }), byPort);
  expect(scales.of(samsung)).toBe(1.5);
  expect(byPort.held).toEqual({});
  expect(scales.of(other)).toBeUndefined();
  expect(scales.of({ ...samsung, name: "DP-1" })).toBe(1.5);
});

test("the scales are kept in displays.json beside the arrangements, and a bad value is left out", () => {
  const path = join(mkdtempSync(join(tmpdir(), "dashi-scales-")), "displays.json");
  new ScreenScales(new DisplayStore({ path })).remember(samsung, 1.75);
  expect(new ScreenScales(new DisplayStore({ path })).of(samsung)).toBe(1.75);
  expect(JSON.parse(readFileSync(path, "utf8")).scales).toEqual({ "edid:Samsung Electric Company|LS40BM|H4ZT600123": 1.75 });
  writeFileSync(path, JSON.stringify({ version: 1, layouts: {}, scales: { a: 9, b: "2", c: 1.5, "": 2 } }));
  expect(parseScales(readFileSync(path, "utf8"))).toEqual({ c: 1.5 });
  expect(parseScales("not json")).toEqual({});
});

test("a saved scale that leaves too little room gives way to the default", () => {
  const screen: ScreenInfo = { ...samsung, width: 1920, height: 1080, widthMm: 890, heightMm: 500, scale: 1 };
  expect(initialScale(screen, () => 1.25)).toBe(1.25);
  expect(initialScale(screen, () => 3)).toBe(1);
  expect(initialScale({ ...screen, width: 3840, height: 2160 }, () => undefined)).toBe(1.5);
});
