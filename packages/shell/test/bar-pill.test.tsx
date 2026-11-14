/**
 * Dashi's mark, the jobs and the field, started together (menubar/start-pill.tsx):
 * the field's surface is over the whole screen with the keyboard, and it
 * gives way to a menu, the Dashi key and the lock, keeping the draft.
 */

import { expect, test } from "bun:test";
import type { NativeHostOptions } from "@mirinjs/metal";
import type { CompositorEvent } from "../src/compositor/events.ts";
import { FIELD_LAYER, frontWatch, startBarPill } from "../src/menubar/index.ts";
import { createPillHub } from "../src/shared/pill/index.ts";

function start() {
  const hub = createPillHub();
  const opened: Array<{ options: NativeHostOptions; closed: boolean }> = [];
  const none: never[] = [];
  const still = { subscribe: () => () => {}, getSnapshot: () => none };
  let menuState: { popover: unknown; bar?: unknown } = { popover: null };
  const menuListeners = new Set<() => void>();
  const locks = new Set<() => void>();
  const fronts = new Set<() => void>();
  const log: string[] = [];
  const { pill, stop } = startBarPill({
    hub,
    open: (options) => {
      const surface = { options, closed: false };
      opened.push(surface);
      return {
        close: () => {
          surface.closed = true;
        },
      };
    },
    tasks: () => null,
    asker: () => ({ ready: () => true, send: () => "ask-1", setUp: () => {} }),
    agents: still,
    runs: still,
    menus: {
      subscribe: (listener) => {
        menuListeners.add(listener);
        return () => menuListeners.delete(listener);
      },
      getSnapshot: () => menuState,
      close: () => log.push("menus closed"),
    },
    primary: () => "eDP-1",
    onLock: (listener) => {
      locks.add(listener);
      return () => locks.delete(listener);
    },
    onFront: (listener) => {
      fronts.add(listener);
      return () => fronts.delete(listener);
    },
    showLauncher: () => log.push("launcher"),
    // The row is not drawn here (the surface is a stand-in), so its sources are never read.
    bar: () => ({}) as ReturnType<Parameters<typeof startBarPill>[0]["bar"]>,
  });
  return {
    hub,
    pill,
    stop,
    opened,
    log,
    locks,
    fronts,
    menus: (state: typeof menuState) => {
      menuState = state;
      for (const listener of menuListeners) listener();
    },
  };
}

test("the field's surface covers the screen from the top edge, on the overlay layer, with the keyboard", () => {
  const { pill, opened, stop } = start();
  pill.field.open("DP-1");
  const surface = opened[0]?.options.surface;
  expect(surface).toMatchObject({
    layer: "overlay",
    anchor: ["top", "bottom", "left", "right"],
    exclusiveZone: -1,
    keyboard: "exclusive",
    namespace: FIELD_LAYER,
    output: "DP-1",
  });
  stop();
  expect(opened[0]?.closed).toBe(true);
});

test("a menu or panel opening, the Dashi key and the lock each close the field and keep the draft", () => {
  const { pill, hub, menus, locks, stop } = start();
  const closedBy = (act: () => void): boolean => {
    pill.field.open(undefined);
    pill.field.type("half a thought");
    act();
    return !pill.field.getSnapshot().open && pill.field.getSnapshot().text === "half a thought";
  };
  expect(closedBy(() => menus({ popover: { kind: "notification-center" } }))).toBe(true);
  menus({ popover: null });
  expect(closedBy(() => menus({ popover: null, bar: "menu:dashi" }))).toBe(true);
  menus({ popover: null });
  expect(closedBy(() => hub.keys.send({ key: "dashi", gesture: "tap", at: 0 }))).toBe(true);
  expect(closedBy(() => hub.keys.send({ key: "dashi", gesture: "hold", at: 0 }))).toBe(true);
  expect(
    closedBy(() => {
      for (const lock of locks) lock();
    }),
  ).toBe(true);
  // The dictation key is not Dashi's: dictating into the row leaves it open.
  expect(closedBy(() => hub.keys.send({ key: "dictation", gesture: "hold", at: 0 }))).toBe(false);
  stop();
});

test("the others' commands reach the field: open on the primary screen, insert at the caret", () => {
  const { pill, hub, opened, stop } = start();
  hub.barCommands.send({ do: "open-field" });
  expect(opened[0]?.options.surface).toMatchObject({ output: "eDP-1" });
  hub.barCommands.send({ do: "insert", text: "book a class" });
  expect(pill.field.getSnapshot().text).toBe("book a class");
  expect(hub.bar.getSnapshot()).toEqual({ mode: "field", text: "book a class" });
  stop();
});

test("the window in front changes: the field closes and keeps its draft", () => {
  const { pill, fronts, stop } = start();
  pill.field.open("eDP-1");
  pill.field.type("Reply to Marta that");
  for (const listener of fronts) listener();
  expect(pill.field.getSnapshot()).toMatchObject({ open: false, text: "Reply to Marta that" });
  pill.field.open("eDP-1");
  expect(pill.field.getSnapshot()).toMatchObject({ open: true, text: "Reply to Marta that" });
  stop();
});

test("what counts as the window in front changing: a window opening or closing, a Space, Mission Control, the switcher; never the clipboard's helper", () => {
  let changes = 0;
  const watch = frontWatch(() => void changes++);
  const hear = (event: Record<string, unknown>): void => watch(event as CompositorEvent);
  const window = (id: number, appId: string) => ({ id, appId });
  hear({ event: "window-opened", window: window(4, "io.github.bugaevc.wl-clipboard") });
  hear({ event: "window-closed", id: 4 });
  hear({ event: "person-input", window: 3 });
  hear({ event: "overview", active: false });
  hear({ event: "binding", name: "switch-cancel" });
  expect(changes).toBe(0);
  hear({ event: "window-opened", window: window(5, "dev.dashi.notes") });
  hear({ event: "window-closed", id: 5 });
  hear({ event: "space", current: 2, previous: 1, count: 2 });
  hear({ event: "overview", active: true });
  hear({ event: "binding", name: "switch-next" });
  expect(changes).toBe(5);
});
