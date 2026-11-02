import { expect, test } from "bun:test";

import { mainScreen, parseScreens } from "../src/screens.ts";

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
