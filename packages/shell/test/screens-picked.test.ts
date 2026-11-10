import { expect, test } from "bun:test";
import { dockScreen } from "../src/dock/animation-targets.ts";
import { captureScreenNear } from "../src/screenshot-area.tsx";

const output = (name: string, x: number) => ({ name, mode: { width: 1920, height: 1080 }, scale: 1, frame: { x, y: 0, width: 1920, height: 1080 } });
const outputs = { outputs: [output("DP-1", 0), output("eDP-1", 1920)] };

test("the Dock goes on its home screen, else on the primary", () => {
  expect(dockScreen(outputs, "DP-1")).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  // Home is gone: the built-in panel is the primary.
  expect(dockScreen(outputs, "HDMI-A-1")?.x).toBe(1920);
  expect(dockScreen(outputs, undefined)?.x).toBe(1920);
  expect(dockScreen({ outputs: [] }, "DP-1")).toBeNull();
});

test("a capture goes on its window's screen, else on the primary", () => {
  expect(captureScreenNear(outputs, { x: 100, y: 100, width: 400, height: 300 }).output).toBe("DP-1");
  expect(captureScreenNear(outputs, null)).toEqual({ output: "eDP-1", origin: { x: 1920, y: 0 } });
  expect(captureScreenNear({ outputs: [] }, null)).toEqual({ origin: { x: 0, y: 0 } });
});
