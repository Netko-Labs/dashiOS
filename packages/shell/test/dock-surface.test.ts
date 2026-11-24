/**
 * The Dock's host dying by itself (dock/lib/surface.ts): it opens again on the same screen a moment
 * later, as the menu bars do, and only one that keeps dying is reported. A Metal host asked for a
 * screen plugged in a moment ago that it never got to know now ends without opening (mirin's
 * `screen.rs`) instead of opening on another screen; before this the shell ended with it.
 */

import { expect, test } from "bun:test";
import { DockSurface } from "../src/dock/lib/surface.ts";

function world() {
  const opened: Array<{ output: string | undefined; variant: string; die: () => void; closed: boolean }> = [];
  const lost: Array<string | undefined> = [];
  const timers: Array<{ fn: () => void; cancelled: boolean }> = [];
  let now = 0;
  const surface = new DockSurface({
    open: (output, onClosed, variant) => {
      const entry = { output, variant, die: onClosed, closed: false };
      opened.push(entry);
      return {
        close: () => {
          entry.closed = true;
        },
      };
    },
    onLost: (output) => lost.push(output),
    now: () => now,
    later: (fn) => {
      const timer = { fn, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
  });
  const runTimers = () => {
    for (const timer of timers.splice(0)) if (!timer.cancelled) timer.fn();
  };
  const tick = (ms: number) => {
    now += ms;
  };
  return { surface, opened, lost, runTimers, tick };
}

test("a Dock whose host died opens again on the same screen, in the same look", () => {
  const { surface, opened, lost, runTimers } = world();
  surface.show("Virtual-2", "dock");
  opened[0]?.die();
  expect(surface.shown).toBe(false);
  runTimers();
  expect(opened.map((each) => [each.output, each.variant])).toEqual([
    ["Virtual-2", "dock"],
    ["Virtual-2", "dock"],
  ]);
  expect(surface.shown).toBe(true);
  expect(lost).toEqual([]);
});

test("one that keeps dying is reported, and the caller decides", () => {
  const { surface, opened, lost, runTimers, tick } = world();
  surface.show("Virtual-2", "dock");
  for (let death = 0; death < 4; death++) {
    opened.at(-1)?.die();
    runTimers();
    tick(1000);
  }
  expect(opened).toHaveLength(4);
  expect(lost).toEqual(["Virtual-2"]);
});

test("moved elsewhere meanwhile, the Dock is not opened again where it died", () => {
  const { surface, opened, runTimers } = world();
  surface.show("Virtual-2", "dock");
  opened[0]?.die();
  surface.show("Virtual-1", "dock");
  runTimers();
  expect(opened.map((each) => each.output)).toEqual(["Virtual-2", "Virtual-1"]);
  expect(surface.output).toBe("Virtual-1");
});
