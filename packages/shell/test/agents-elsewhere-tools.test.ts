/**
 * What the tools do for an agent at work on another Desktop (agents/desktop/elsewhere.ts):
 * focus without switching, input where a window waits, the bar's words, and following a Space.
 */

import { describe, expect, test } from "bun:test";
import type { RunContext } from "../src/agents/context.ts";
import { handsCall } from "../src/agents/desktop/input.ts";
import { runCall } from "../src/agents/lib/run/run.ts";
import { SessionStatus } from "../src/agents/lib/session/session-status.ts";
import { Followed } from "../src/spaces/lib/followed.ts";
import { desk, window, words } from "./support/elsewhere.ts";

describe("the tools, from an agent at work on another Desktop", () => {
  test("focus_window raises a window there without switching; elsewhere it is as ever", async () => {
    const d = desk(3, [window(1, 2), window(2, 0)]);
    await d.elsewhere.go(2, d.ctx);
    const there = await runCall({ name: "focus_window", window: 1 }, d.ctx);
    expect(words(there)).toBe("w1 (“Window 1”) is in front on Desktop 3; the person's screen did not change.");
    await runCall({ name: "focus_window", window: 2 }, d.ctx);
    expect(d.focused).toEqual([{ window: 1, stay: true }, { window: 2 }]);
    // Without work_in_space, focus_window goes to the window's Space, as today.
    await d.elsewhere.go("shown", d.ctx);
    await runCall({ name: "focus_window", window: 1 }, d.ctx);
    expect(d.focused.at(-1)).toEqual({ window: 1 });
  });

  test("a click reaches a window where it waits, checked against its size there", async () => {
    const d = desk(2);
    const sent: Array<Record<string, unknown>> = [];
    const away = window(5, 1, { appId: "org.gnome.TextEditor", away: { x: 40, y: 60, width: 400, height: 330 }, titleBar: 30 });
    const ctx = {
      ...d.ctx,
      compositor: { windows: async () => [away] },
      hands: { send: async (_window: unknown, payload: Record<string, unknown>) => void sent.push(payload) },
      agent: "Claude",
    } as unknown as RunContext;
    const clicked = await handsCall({ name: "click", window: 5, x: 20, y: 290, button: "left", count: 1 }, ctx);
    expect(clicked.isError).toBeUndefined();
    expect(sent).toEqual([{ pointer: { x: 20, y: 290 }, action: "click", button: "left" }]);
    // The bar says where: the person sent it out of their way, and reads which Desktop it is on.
    expect(d.said.at(-1)).toBe("Clicking in “Window 5” on Desktop 2");
    // Its content is 400×300 (the title bar is not the app's).
    const outside = await handsCall({ name: "click", window: 5, x: 20, y: 310, button: "left", count: 1 }, ctx);
    expect(words(outside)).toContain("outside w5, whose content is 400×300 points");
    // Minimized there, it is not there to click.
    away.state = "minimized";
    expect((await handsCall({ name: "click", window: 5, x: 20, y: 20, button: "left", count: 1 }, ctx)).isError).toBe(true);
  });
});

test("the bar says where an agent works while it rests, and what it does while it acts", () => {
  const status = new SessionStatus(
    () => {},
    () => false,
  );
  expect(status.shown(null)).toBe("Connected");
  expect(status.shown("Desktop 3")).toBe("Working on Desktop 3");
  status.set("Typing in w5");
  expect(status.shown("Desktop 3")).toBe("Typing in w5");
});

test("Spaces someone follows keep their place through the renumbering", () => {
  const followed = new Followed();
  const [first, last] = [followed.follow(0), followed.follow(3)];
  followed.inserted(1);
  expect([first.index, last.index]).toEqual([0, 4]);
  followed.inserted(0);
  expect([first.index, last.index]).toEqual([1, 5]);
  followed.removed(2);
  expect([first.index, last.index]).toEqual([1, 4]);
  followed.fit(4);
  expect([first.index, last.index]).toEqual([1, null]);
  followed.removed(1);
  expect(first.index).toBeNull();
  // Let go of, it is no longer moved.
  const loose = followed.follow(2);
  followed.unfollow(loose);
  followed.inserted(0);
  expect(loose.index).toBe(2);
});
