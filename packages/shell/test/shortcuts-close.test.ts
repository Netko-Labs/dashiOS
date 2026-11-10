import { expect, test } from "bun:test";
import { reservedBy } from "../src/app-menus/reserved.ts";
import { resolveChord } from "../src/keymap-match.ts";
import { type Requests, runBinding, type ShellActions } from "../src/shortcuts.ts";
import { fakeCompositor } from "./support/compositor.ts";

function setup(handled: boolean) {
  const requests: [string, unknown][] = [];
  const asked: [number, string][] = [];
  const compositor: Requests = fakeCompositor(
    async (name, args) => {
      requests.push([name, args]);
      return {};
    },
    { windows: async () => [] },
  );
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

const pressed = (shift: boolean) => ({ key: "w", shift, ctrl: false, alt: false });

test("⇧❖W runs the app's own ⇧❖W row (Terminal's Close Window), not its ❖W row", async () => {
  const { compositor, actions, requests, asked } = setup(true);
  await runBinding("close-window", 7, compositor, actions, pressed(true));
  expect(asked).toEqual([[7, "⇧❖W"]]);
  expect(requests).toEqual([]);
});

test("❖W pressed without Shift still asks for the ❖W row", async () => {
  const { compositor, actions, asked } = setup(true);
  await runBinding("close-window", 7, compositor, actions, pressed(false));
  expect(asked).toEqual([[7, "❖W"]]);
});

test("⇧❖W closes the window when the app has no ⇧❖W row", async () => {
  const { compositor, actions, requests } = setup(false);
  await runBinding("close-window", 7, compositor, actions, pressed(true));
  expect(requests).toEqual([["close", { window: 7 }]]);
});

test("the keymap binds ❖W and ⇧❖W in Dashi's apps to close-window, and leaves both rows to the app", () => {
  for (const shift of [false, true]) {
    const mods: ("super" | "shift")[] = shift ? ["super", "shift"] : ["super"];
    expect(resolveChord({ mods, key: "w" }, "dev.dashi.terminal")).toEqual({ kind: "bind", name: "close-window" });
    expect(reservedBy(pressed(shift))).toBeNull();
  }
  // The shell's own keys stay its own.
  expect(reservedBy({ key: "q", shift: false, ctrl: false, alt: false })).toBe("super+q");
});
