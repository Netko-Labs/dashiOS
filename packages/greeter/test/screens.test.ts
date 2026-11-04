import { expect, test } from "bun:test";

import { mainScreen, parseScreens, scalesToSet } from "../src/screens.ts";

test("the enabled screens, and the main one first of all", () => {
  const screens = parseScreens({
    outputs: [
      { name: "eDP-1", enabled: true, primary: false },
      { name: "DP-1", enabled: true, primary: true },
      { name: "HDMI-A-1", enabled: false, primary: false },
      { name: 7 },
    ],
  });
  expect(screens).toEqual([
    { name: "eDP-1", primary: false },
    { name: "DP-1", primary: true },
  ]);
  expect(mainScreen(screens)).toBe("DP-1");
  expect(mainScreen([{ name: "eDP-1", primary: false }])).toBe("eDP-1");
  expect(mainScreen([])).toBeUndefined();
  expect(parseScreens(null)).toEqual([]);
});

test("each screen gets the scale its density wants; one already there, or unknown in size, is left", () => {
  // A 14" 2880×1800 panel (300×190 mm, a real laptop's): 2, as the desktop picks with nothing saved.
  const panel = { name: "eDP-1", enabled: true, scale: 1, mode: { width: 2880, height: 1800 }, physicalMm: { width: 300, height: 190 } };
  expect(scalesToSet({ outputs: [panel] })).toEqual([{ name: "eDP-1", scale: 2 }]);
  expect(scalesToSet({ outputs: [{ ...panel, scale: 2 }] })).toEqual([]);
  // No physical size (a VM, a projector): left at its scale.
  expect(scalesToSet({ outputs: [{ ...panel, physicalMm: { width: 0, height: 0 } }] })).toEqual([]);
  expect(scalesToSet({ outputs: [{ ...panel, enabled: false }] })).toEqual([]);
  expect(scalesToSet(null)).toEqual([]);
});
