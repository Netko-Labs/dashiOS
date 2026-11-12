import { expect, test } from "bun:test";

import { outputsOf } from "../src/compositor/outputs.ts";
import { monitorsOf } from "../src/display-config/monitors.ts";
import { toWire } from "../src/display-config/plan.ts";

const output = {
  name: "DP-1",
  make: "Dell",
  model: "U2720Q",
  mode: { width: 3840, height: 2160, refreshMhz: 60000 },
  modes: [],
};

test("variable refresh rate is read, off when not said", () => {
  const [on] = monitorsOf(
    outputsOf({
      outputs: [{ ...output, vrr: { supported: true, active: true, mode: "fullscreen" } }],
    }),
  );
  expect(on?.vrr).toEqual({
    supported: true,
    active: true,
    mode: "fullscreen",
  });
  const [old] = monitorsOf(outputsOf({ outputs: [output] }));
  expect(old?.vrr).toEqual({ supported: false, active: false, mode: "off" });
  const [odd] = monitorsOf(outputsOf({ outputs: [{ ...output, vrr: { supported: true, mode: "sometimes" } }] }));
  expect(odd?.vrr).toEqual({ supported: true, active: false, mode: "off" });
});

test("a variable refresh rate choice goes out only when made", () => {
  expect(toWire({ outputs: [{ name: "DP-1", vrr: "on" }] })).toEqual({
    outputs: [{ name: "DP-1", vrr: "on" }],
  });
  expect(toWire({ outputs: [{ name: "DP-1", scale: 2 }] })).toEqual({
    outputs: [{ name: "DP-1", scale: 2 }],
  });
});
