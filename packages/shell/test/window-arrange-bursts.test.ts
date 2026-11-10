/**
 * Bursts of keys: arrows, Fill, Center and full screen pressed together end where the same keys pressed
 * slowly end, however late the app draws.
 */

import { describe, expect, test } from "bun:test";
import type { Arranger } from "../src/arrange/arrange.ts";
import { tileFrame } from "../src/layout.ts";
import { files, rect, started, USABLE } from "./support/window-arrange.ts";

describe("bursts of keys", () => {
  type Step = { kind: "arrow"; arrow: "left" | "right" | "up" | "down" } | { kind: "arrange"; to: "fill" | "center" | "restore" } | { kind: "fullscreen" };
  const run = (arranger: Arranger, step: Step): Promise<void> =>
    step.kind === "arrow" ? arranger.arrow(7, step.arrow) : step.kind === "arrange" ? arranger.arrange(7, step.to) : arranger.toggleFullscreen(7);

  test("⌃❖↑ ⌃❖R ⌃❖↓ ⌃❖↩ ⌃❖C at once, the app drawing none of it yet: its own size, centered", async () => {
    const { arranger, frames } = await started(files(), undefined, true);
    const steps: Step[] = [
      { kind: "arrow", arrow: "up" },
      { kind: "arrange", to: "restore" },
      { kind: "arrow", arrow: "down" },
      { kind: "arrange", to: "fill" },
      { kind: "arrange", to: "center" },
    ];
    await Promise.all(steps.map((step) => run(arranger, step)));
    expect(frames().at(-1)).toEqual(["frame", { window: 7, ...rect(423, 147, 800, 600) }]);
    expect(arranger.arrangement(7)).toBeNull();
  });

  test("keys pressed together act in order: ← then ↑ is the top left", async () => {
    const { arranger, frames } = await started();
    await Promise.all([arranger.arrow(7, "left"), arranger.arrow(7, "up")]);
    expect(arranger.arrangement(7)).toBe("top-left");
    expect(frames().at(-1)).toEqual(["frame", { window: 7, ...tileFrame("top-left", USABLE), tiled: true }]);
  });

  test("any burst ends where the same keys pressed slowly end, however late the app draws", async () => {
    const choices: Step[] = [
      { kind: "arrow", arrow: "left" },
      { kind: "arrow", arrow: "right" },
      { kind: "arrow", arrow: "up" },
      { kind: "arrow", arrow: "down" },
      { kind: "arrange", to: "fill" },
      { kind: "arrange", to: "center" },
      { kind: "arrange", to: "restore" },
      { kind: "fullscreen" },
    ];
    // A fixed seed: the same bursts every run.
    let seed = 20261105;
    const random = (below: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % below;
    };
    const name = (step: Step) => (step.kind === "arrow" ? step.arrow : step.kind === "arrange" ? step.to : "fullscreen");
    for (let burst = 0; burst < 200; burst++) {
      const steps = Array.from({ length: 3 + random(4) }, () => choices[random(choices.length)] as Step);
      const slow = await started();
      for (const step of steps) await run(slow.arranger, step);
      const fast = await started(files(), undefined, true);
      const catchUpAt = random(steps.length + 1);
      await Promise.all(
        steps.map(async (step, index) => {
          if (index === catchUpAt) fast.catchUp();
          await run(fast.arranger, step);
        }),
      );
      fast.catchUp();
      const label = steps.map(name).join(" ");
      expect({ burst: label, frame: fast.window.frame, fullscreen: fast.window.fullscreen ?? false, arrangement: fast.arranger.arrangement(7) }).toEqual({
        burst: label,
        frame: slow.window.frame,
        fullscreen: slow.window.fullscreen ?? false,
        arrangement: slow.arranger.arrangement(7),
      });
    }
  });
});
