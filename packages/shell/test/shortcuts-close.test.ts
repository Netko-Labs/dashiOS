import { expect, test } from "bun:test";
import { type Requests, runBinding, type ShellActions } from "../src/shortcuts.ts";

function setup(handled: boolean) {
  const requests: [string, unknown][] = [];
  const asked: [number, string][] = [];
  const compositor = {
    request: async (name: string, args: unknown) => {
      requests.push([name, args]);
      return {};
    },
    windows: async () => [],
  } as unknown as Requests;
  const actions = {
    hardware: { run: async () => false },
    appShortcut: async (window: number, shortcut: string) => {
      asked.push([window, shortcut]);
      return handled;
    },
  } as unknown as ShellActions;
  return { compositor, actions, requests, asked };
}

test("❖W runs the app's own ❖W row (Terminal's Close Tab) instead of closing the window", async () => {
  const { compositor, actions, requests, asked } = setup(true);
  await runBinding("close-window", 7, compositor, actions);
  expect(asked).toEqual([[7, "❖W"]]);
  expect(requests).toEqual([]);
});

test("❖W closes the window when the app has no ❖W row", async () => {
  const { compositor, actions, requests } = setup(false);
  await runBinding("close-window", 7, compositor, actions);
  expect(requests).toEqual([["close", { window: 7 }]]);
});
