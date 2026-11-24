/**
 * A monitor unplugged and plugged back into a set with nothing saved (display-config/lib/seen.ts,
 * decisions.md D538): it comes back as the set last ran this session, where it was, at the mode it
 * ran, and main if it was main; never as a second screen on the right of the one left. The VM's
 * installed pass found its main display back right of screen 2, with screen 2 main
 * (dashi-0.10.0-review/04-screens-installed, bug 3).
 */

import { expect, test } from "bun:test";
import type { CompositorEvent } from "../src/compositor/index.ts";
import { outputsOf } from "../src/compositor/outputs.ts";
import { DisplayManager } from "../src/display-config/manager.ts";
import { monitorsOf } from "../src/display-config/monitors.ts";
import { planRestore } from "../src/display-config/plan.ts";
import { DisplayStore } from "../src/display-config/saved.ts";
import { fakeCompositor } from "./support/compositor.ts";
import { flush } from "./support/time.ts";

const mode = (width: number, height: number, current = false) => ({ width, height, refreshMhz: 59885, preferred: width === 640, current });

/** A VM head with no EDID: QEMU's 640 × 480 preferred, 1920 × 1200 offered. */
const head = (name: string, x: number, width: number, height: number, primary: boolean) => ({
  name,
  make: "",
  model: "",
  serial: "",
  enabled: true,
  lit: true,
  primary,
  physicalMm: { width: 0, height: 0 },
  scale: 1,
  transform: { rotation: 0, flipped: false },
  mode: { width, height, refreshMhz: 59885 },
  modes: [mode(640, 480, width === 640), mode(1920, 1200, width === 1920), mode(1024, 768, width === 1024)],
  frame: { x, y: 0, width, height },
  vrr: { supported: false, active: false, mode: "off" },
});

test("the main display unplugged and plugged back comes back main, on the left, at the mode it ran", async () => {
  let outputs = [head("Virtual-1", 0, 1920, 1200, true), head("Virtual-2", 1920, 1024, 768, false)];
  const asked: unknown[] = [];
  let listener: ((event: CompositorEvent) => void) | null = null;
  const compositor = fakeCompositor(
    async (method, params) => {
      if (method === "outputs") return { outputs };
      asked.push(params);
      return {};
    },
    {
      on: (each: (event: CompositorEvent) => void) => {
        listener = each;
        return () => {};
      },
    },
  );
  const manager = new DisplayManager({ compositor, store: new DisplayStore({ path: null }), scaleFor: () => 1 });
  const changed = async () => {
    listener?.({ event: "outputs-changed" });
    await flush();
    await manager.restore();
  };
  manager.start();
  await flush();
  await changed();
  // Screen 1 unplugged: screen 2 alone, main.
  outputs = [head("Virtual-2", 0, 1024, 768, true)];
  await changed();
  // Back, at its 640 × 480 first, right of screen 2, which is still main.
  asked.length = 0;
  outputs = [head("Virtual-2", 0, 1024, 768, true), head("Virtual-1", 1024, 640, 480, false)];
  await changed();
  expect(asked[0]).toEqual({
    outputs: [
      { name: "Virtual-2", position: { x: 1920, y: 0 } },
      { name: "Virtual-1", mode: { width: 1920, height: 1200, refreshMhz: 59885 }, position: { x: 0, y: 0 } },
    ],
    primary: "Virtual-1",
  });
});

test("a set never seen: the built-in panel is main, else the main display the person last had", () => {
  const monitors = monitorsOf(outputsOf({ outputs: [head("Virtual-2", 0, 1024, 768, true), head("Virtual-1", 1024, 1920, 1200, false)] }));
  const options = { lidClosed: false, scaleFor: () => 1, defaultModes: false };
  expect(planRestore(monitors, undefined, options)?.primary).toBeUndefined();
  expect(planRestore(monitors, undefined, { ...options, previousMain: "Virtual-1" })?.primary).toBe("Virtual-1");
  const laptop = monitorsOf(outputsOf({ outputs: [head("Virtual-2", 0, 1024, 768, true), head("eDP-1", 1024, 1920, 1200, false)] }));
  expect(planRestore(laptop, undefined, { ...options, previousMain: "Virtual-2" })?.primary).toBe("eDP-1");
});
