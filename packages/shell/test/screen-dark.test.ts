import { expect, test } from "bun:test";
import { outputsOf } from "../src/compositor/outputs.ts";
import { builtinScreens, isBuiltin, ScreenDark } from "../src/system/lib/screen-dark.ts";
import { fakeCompositor } from "./support/compositor.ts";

const OUTPUTS = { outputs: [{ name: "eDP-1" }, { name: "DP-3" }, { name: "HDMI-A-1" }, { nope: 1 }] };

function host() {
  const calls: unknown[] = [];
  const compositor = fakeCompositor(async (method, params) => {
    if (method === "outputs") return OUTPUTS;
    calls.push({ method, ...params });
    return {};
  });
  return Object.assign(compositor, { calls });
}

test("the built-in panels by connector name", () => {
  expect(["eDP-1", "LVDS-1", "DSI-2", "DP-1", "HDMI-A-1", "Virtual-1"].map(isBuiltin)).toEqual([true, true, true, false, false, false]);
  expect(builtinScreens(outputsOf(OUTPUTS))).toEqual(["eDP-1"]);
  expect(builtinScreens(outputsOf(null))).toEqual([]);
});

test("brightness 0 holds the built-in screen dark; the first rise lights it, once", async () => {
  const fake = host();
  const dark = new ScreenDark(fake);
  await dark.follow(0.5);
  expect(fake.calls).toEqual([]);
  await Promise.all([dark.follow(0.0625), dark.follow(0), dark.follow(0)]);
  expect(fake.calls).toEqual([{ method: "power", on: false, output: "eDP-1" }]);
  await dark.follow(0.0625);
  await dark.follow(0.125);
  expect(fake.calls).toEqual([
    { method: "power", on: false, output: "eDP-1" },
    { method: "power", on: true, output: "eDP-1" },
  ]);
});

test("a shell started at 0 lights a screen an earlier one left dark", async () => {
  const fake = host();
  await new ScreenDark(fake, true).follow(0.0625);
  expect(fake.calls).toEqual([{ method: "power", on: true, output: "eDP-1" }]);
});

test("a request the compositor refuses is asked again at the same level", async () => {
  const calls: unknown[] = [];
  let refuse = true;
  const fake = fakeCompositor(async (method, params) => {
    if (method === "outputs") return OUTPUTS;
    calls.push({ method, ...params });
    if (refuse) throw new Error("no such output");
    return {};
  });
  const error = console.error;
  console.error = () => {};
  try {
    const dark = new ScreenDark(fake);
    await dark.follow(0);
    refuse = false;
    // Still at 0: the screen is not dark yet, so it is asked again, not taken as done.
    await dark.follow(0);
    await dark.follow(0);
  } finally {
    console.error = error;
  }
  expect(calls).toEqual([
    { method: "power", on: false, output: "eDP-1" },
    { method: "power", on: false, output: "eDP-1" },
  ]);
});
