import { expect, test } from "bun:test";
import type { Compositor, CompositorEvent } from "../src/compositor.ts";
import { type ShellActions, startShortcuts } from "../src/shortcuts.ts";
import { settle } from "./support/time.ts";

/** The shortcuts on a fake compositor: `emit` plays its events, `done` lists what the shell did. */
function setup() {
  let listener: ((event: CompositorEvent) => void) | null = null;
  const done: string[] = [];
  let locked = false;
  const compositor = {
    on: (heard: (event: CompositorEvent) => void) => {
      listener = heard;
      return () => {};
    },
    request: async (method: string, params: unknown) => {
      done.push(`${method} ${JSON.stringify(params)}`);
      return {};
    },
    windows: async () => [],
  } as unknown as Compositor;
  const actions = {
    toggleLauncher: () => done.push("launcher"),
    showSheet: () => done.push("sheet"),
    hideSheet: () => done.push("hide sheet"),
    switcher: { commit: () => done.push("switcher commit"), step: () => {}, cancel: () => {} },
    hardware: { run: async () => false },
    appShortcut: async () => false,
    launcher: {
      binding: (name: string, _chord: unknown, text?: string) => name === "launcher-type" && done.push(`typed ${text}`) > 0,
    },
    isLocked: () => locked,
  } as unknown as ShellActions;
  startShortcuts(compositor, actions);
  const emit = (event: Record<string, unknown>) => listener?.(event as CompositorEvent);
  return {
    emit,
    done,
    lock: (on: boolean) => {
      locked = on;
    },
  };
}

test("while locked a ❖ tap opens no launcher and a hold no sheet behind the lock screen", async () => {
  const { emit, done, lock } = setup();
  lock(true);
  emit({ event: "super", phase: "tap" });
  emit({ event: "super", phase: "hold" });
  // A chord and ❖ coming up still take a sheet down.
  emit({ event: "super", phase: "chord" });
  emit({ event: "super", phase: "up" });
  await settle();
  expect(done).toEqual(["hide sheet", "hide sheet", "switcher commit"]);
});

test("while locked a binding already on its way types nothing into the window it names", async () => {
  const { emit, done, lock } = setup();
  lock(true);
  // ❖A pressed in Settings just before the lock: its app-chord would send Ctrl+A to Settings.
  emit({ event: "binding", name: "app-chord", window: 7, chord: { key: "a", shift: false, ctrl: false, alt: false } });
  emit({ event: "binding", name: "launcher", window: null });
  await settle();
  expect(done).toEqual([]);
});

test("unlocked, the same events act as before", async () => {
  const { emit, done } = setup();
  emit({ event: "super", phase: "tap" });
  emit({ event: "binding", name: "app-chord", window: 7, chord: { key: "a", shift: false, ctrl: false, alt: false } });
  await settle();
  expect(done).toEqual(["launcher", 'send-keys {"window":7,"chord":"ctrl+a"}']);
});

test("❖Space opens the launcher before the next event: keys typed after it in the same breath find it opening", () => {
  const { emit, done } = setup();
  // No await between them: the compositor played ❖Space and the letters queued behind it at once.
  emit({ event: "binding", name: "launcher", window: 4 });
  emit({ event: "binding", name: "launcher-type", window: 4, key: "s", text: "s" });
  expect(done).toEqual(["launcher", "typed s"]);
});
