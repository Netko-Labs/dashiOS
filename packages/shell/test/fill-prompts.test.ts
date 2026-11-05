import { describe, expect, test } from "bun:test";
import { FillPrompts, PROMPT_MS } from "../src/agents/fill-prompts.ts";
import type { CompositorWindow } from "../src/compositor.ts";

const win = (id: number, pid: number | null): CompositorWindow => ({ id, pid }) as CompositorWindow;

describe("what an app shows back after a fill", () => {
  test("its popups are blanked for a while after the fill, and windows it opens since, while they live", async () => {
    let now = 1_000;
    let windows = [win(3, 100), win(4, 100), win(5, 200)];
    const prompts = new FillPrompts(
      async () => windows,
      () => now,
    );
    expect(prompts.blank(windows)).toEqual({ popups: [], windows: [] });
    prompts.touched(3);
    await Bun.sleep(0);
    // Firefox opens a window of its own (6); another app's (7) is no prompt of it; 4 was there before.
    windows = [...windows, win(6, 100), win(7, 200)];
    expect(prompts.blank(windows)).toEqual({ popups: [3], windows: [6] });
    // A minute on, the popups are the agent's again; the window that opened stays blanked while it lives.
    now += PROMPT_MS;
    expect(prompts.blank(windows)).toEqual({ popups: [], windows: [6] });
    windows = windows.filter((w) => w.id !== 6);
    expect(prompts.blank(windows)).toEqual({ popups: [], windows: [] });
  });

  test("a filled field still around keeps it going", () => {
    let now = 0;
    const windows = [win(3, 100)];
    const prompts = new FillPrompts(
      async () => windows,
      () => now,
    );
    prompts.touched(3);
    now += PROMPT_MS - 1;
    prompts.touched(3);
    now += PROMPT_MS - 1;
    expect(prompts.blank(windows).popups).toEqual([3]);
  });

  test("a window touched before its app's windows are known knows them at the next picture", () => {
    const windows = [win(3, 100), win(4, 100)];
    const prompts = new FillPrompts(() => new Promise(() => {}));
    prompts.touched(3);
    expect(prompts.blank(windows)).toEqual({ popups: [3], windows: [] });
  });
});
