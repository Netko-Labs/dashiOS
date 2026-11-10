import { describe, expect, test } from "bun:test";
import { Arranger } from "../src/arrange.ts";
import type { Compositor, CompositorEvent, CompositorWindow } from "../src/compositor.ts";
import type { Rect } from "../src/layout.ts";
import { buildMenu, type MenuContext } from "../src/menus/model.ts";
import { parseSettings } from "../src/settings.ts";
import { SpacesController, type SpacesSettings } from "../src/spaces/controller.ts";
import { edgeHoldTarget } from "../src/spaces/edge.ts";
import { FullscreenDesktops } from "../src/spaces/fullscreen.ts";
import { spaceLabels } from "../src/spaces/names.ts";
import { desktopCount, desktopOrdinal, fitSlots, insertionPoint, nearestDesktop, originOf, recoverSlots, type Slots } from "../src/spaces/slots.ts";
import { fakeClock, settle } from "./support/time.ts";

const SCREEN: Rect = { x: 0, y: 0, width: 1646, height: 937 };
const USABLE: Rect = { x: 0, y: 28, width: 1646, height: 838 };

const win = (id: number, space: number, more: Partial<CompositorWindow> = {}): CompositorWindow => ({
  id,
  appId: `app.${id}`,
  title: `Window ${id}`,
  pid: null,
  focused: false,
  state: "normal",
  frame: { x: 100, y: 100, width: 800, height: 600 },
  titleBar: 0,
  space,
  ...more,
});

describe("which Spaces are full-screen Desktops", () => {
  const slots: Slots = [null, 7, null, 8, 9, null];

  test("Desktops are counted and named without the full-screen ones", () => {
    expect(desktopCount(slots)).toBe(3);
    expect(desktopOrdinal(slots, 0)).toBe(0);
    expect(desktopOrdinal(slots, 2)).toBe(1);
    expect(desktopOrdinal(slots, 5)).toBe(2);
  });

  test("the Desktop a full-screen one goes back to is the nearest on its left, else on its right", () => {
    expect(nearestDesktop(slots, 1)).toBe(0);
    expect(nearestDesktop(slots, 4)).toBe(2);
    expect(nearestDesktop([5, null], 0)).toBe(1);
    expect(nearestDesktop([5], 0)).toBeNull();
    // A dialog on a full-screen Desktop comes from that Desktop's own.
    expect(originOf(slots, 3)).toBe(2);
    expect(originOf(slots, 2)).toBe(2);
    expect(originOf(slots, 9)).toBeNull();
  });

  test("a new one goes right after its Desktop, after the ones from there already", () => {
    expect(insertionPoint(slots, 0)).toBe(2);
    expect(insertionPoint(slots, 2)).toBe(5);
    expect(insertionPoint(slots, 5)).toBe(6);
  });

  test("Spaces the compositor added or dropped by itself are Desktops at the end", () => {
    expect(fitSlots([null, 4], 4)).toEqual([null, 4, null, null]);
    expect(fitSlots([null, 4, null], 1)).toEqual([null]);
  });

  test("after a restart: a Space whose one window is full screen, its dialogs and sheets aside", () => {
    const windows = [
      win(1, 0),
      win(2, 1, { fullscreen: true }),
      win(3, 1, { parent: 2 }),
      win(4, 1, { sheetOf: 2 }),
      win(5, 2, { fullscreen: true }),
      win(6, 2),
      win(7, 3, { fullscreen: true, state: "minimized" }),
    ];
    expect(recoverSlots(4, windows)).toEqual([null, 2, null, null]);
    // settings.json counted 4 Desktops of 4 Spaces: none was a full-screen one.
    expect(recoverSlots(4, windows, 0)).toEqual([null, null, null, null]);
    // One Desktop is always left.
    expect(recoverSlots(1, [win(1, 0, { fullscreen: true })])).toEqual([null]);
  });

  test("a full-screen Desktop is named after its app, and the names skip it", () => {
    const windows = [win(1, 0), win(2, 1, { appId: "game" }), win(3, 2)];
    const appName = (window: CompositorWindow) => (window.appId === "game" ? "Game" : window.appId);
    expect(spaceLabels(4, ["Work", "Play"], windows, appName, [null, 2, null, null])).toEqual(["Work", "Game", "Play", "Desktop 4"]);
  });

  test("a held window passes over full-screen Desktops at the edge", () => {
    const one = [{ name: "eDP-1", frame: SCREEN, usable: USABLE, scale: 1 }];
    const hold = { edge: "right" as const, output: "eDP-1", preview: false };
    expect(edgeHoldTarget(hold, one, { count: 4, current: 0 }, [null, 5, null, 6])).toBe(2);
    expect(edgeHoldTarget(hold, one, { count: 4, current: 2 }, [null, 5, null, 6])).toBeNull();
    expect(edgeHoldTarget({ ...hold, edge: "left" }, one, { count: 4, current: 2 }, [null, 5, null, 6])).toBe(0);
  });

  test("the setting is on unless turned off", () => {
    expect(parseSettings({}).settings.spaces.fullscreenDesktop).toBe(true);
    expect(parseSettings({ spaces: { fullscreenDesktop: false } }).settings.spaces.fullscreenDesktop).toBe(false);
  });

  test("the Window menu offers no full-screen Desktop, and nothing for a window on its own", () => {
    const focused = win(1, 0);
    const ctx = (window: CompositorWindow): MenuContext => ({
      appName: "App",
      windows: [window],
      focused: window,
      canLaunch: false,
      canOpenHelp: false,
      desktops: { labels: ["Desktop 1", "Game", "Desktop 3"], current: 0, fullscreen: [null, 2, null] },
    });
    const labels = (window: CompositorWindow) =>
      buildMenu("window", ctx(window)).flatMap((entry) => (entry.kind === "item" && entry.label.startsWith("Move to") ? [entry.label] : []));
    expect(labels(focused)).toEqual(["Move to Desktop 3", "Move to New Desktop"]);
    expect(labels(win(2, 1))).toEqual([]);
  });
});

type Window = CompositorWindow;

/**
 * A compositor that keeps Spaces as dashi-comp does: each window's Space,
 * `space-add {at}` moving the later ones up, `space-remove` giving a Space's
 * windows to the one on its left (the first's to the second), switches (the
 * `space` event a little later, as a slide ends), full screen, and a window
 * placed on a Space. Every request is kept, in order.
 */
function fakeCompositor(windows: Window[], count = 1) {
  const listeners = new Set<(event: CompositorEvent) => void>();
  const requests: Array<[string, Record<string, unknown>]> = [];
  const state = { count, current: 0, windows };
  const emit = (event: CompositorEvent) => {
    for (const listener of [...listeners]) listener(event);
  };
  const moved = (window: Window, space: number) => {
    window.space = space;
    emit({ event: "window-space", window: window.id, space });
  };
  const answer = () => ({ count: state.count, current: state.current });
  const spaceEvent = (previous: number) => emit({ event: "space", current: state.current, previous, count: state.count });
  const compositor = {
    on(listener: (event: CompositorEvent) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    windows: async () => state.windows.map((window) => ({ ...window })),
    async request(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
      requests.push([method, params]);
      const id = params.window as number;
      const window = state.windows.find((each) => each.id === id);
      switch (method) {
        case "spaces":
          if (typeof params.count === "number") {
            state.count = params.count;
            for (const each of state.windows) if ((each.space ?? 0) >= state.count) moved(each, state.count - 1);
            state.current = Math.min(state.current, state.count - 1);
            spaceEvent(state.current);
          }
          return answer();
        case "space-add": {
          const at = typeof params.at === "number" ? params.at : state.count;
          for (const each of state.windows) if ((each.space ?? 0) >= at) moved(each, (each.space ?? 0) + 1);
          if (state.current >= at) state.current++;
          state.count++;
          spaceEvent(state.current);
          return { ...answer(), space: at };
        }
        case "space-remove": {
          const space = params.space as number;
          if (state.count <= 1) throw new Error("the last Space stays");
          const into = space === 0 ? 1 : space - 1;
          if (state.current === space) state.current = into;
          for (const each of state.windows) if ((each.space ?? 0) === space) moved(each, into);
          for (const each of state.windows) if ((each.space ?? 0) > space) moved(each, (each.space ?? 0) - 1);
          if (state.current > space) state.current--;
          state.count--;
          spaceEvent(state.current);
          return answer();
        }
        case "space-move":
          if (window) moved(window, params.space as number);
          return {};
        case "space-switch": {
          const previous = state.current;
          const carried = state.windows.find((each) => each.id === params.carry);
          if (params.carry !== undefined && (carried?.space ?? -1) !== state.current) throw new Error("not on the Space that shows");
          // The slide ends a little later; a carried window lands on the new Space then.
          setImmediate(() => {
            state.current = params.space as number;
            if (carried) moved(carried, state.current);
            spaceEvent(previous);
          });
          return answer();
        }
        case "fullscreen":
          if (window) window.fullscreen = params.on === true ? true : undefined;
          return {};
        case "outputs":
          return { outputs: [{ name: "Virtual-1", frame: SCREEN, usable: USABLE, scale: 1 }] };
        case "place":
          if (window) window.space = typeof params.space === "number" ? params.space : state.current;
          return {};
        default:
          return {};
      }
    },
  };
  return {
    compositor,
    state,
    requests,
    emit,
    /** The requests that change Spaces or full screen, in order. */
    moves: () => requests.filter(([method]) => method.startsWith("space-") || method === "fullscreen").map(([method, params]) => [method, params]),
  };
}
const SETTINGS: SpacesSettings = { count: 2, switchOnActivate: true, fullscreenDesktop: true };

/** The Spaces controller and the full-screen Desktops on a fake, settings applied. */
async function desk(windows: Window[], count = 2, settings: SpacesSettings = SETTINGS) {
  const fake = fakeCompositor(windows, count);
  const saved: number[] = [];
  const desktops = new SpacesController(fake.compositor as unknown as Compositor, (each) => saved.push(each), {
    appName: (window) => `App ${window.id}`,
  });
  desktops.start();
  await desktops.apply(settings);
  const fullscreen = new FullscreenDesktops({ compositor: fake.compositor as unknown as Compositor, desktops, slideWaitMs: 200 });
  fullscreen.enabled = settings.fullscreenDesktop !== false;
  fullscreen.start();
  await settle();
  fake.requests.length = 0;
  /** As arrange.ts does: the window as it is, and the request to toggle. */
  const toggle = async (id: number, on: boolean) => {
    const window = fake.state.windows.find((each) => each.id === id);
    if (!window) throw new Error(`no window ${id}`);
    await fullscreen.around({ ...window }, on, async () => {
      await fake.compositor.request("fullscreen", { window: id, on });
    });
    await settle();
  };
  return { fake, desktops, fullscreen, saved, toggle };
}

describe("a full-screen window's own Desktop", () => {
  test("entering: a Desktop right after its own, full screen where it is, then carried there", async () => {
    const { fake, desktops, saved, toggle } = await desk([win(1, 0), win(2, 1)]);
    await toggle(1, true);
    expect(fake.moves()).toEqual([
      ["space-add", { at: 1 }],
      ["fullscreen", { window: 1, on: true }],
      ["space-switch", { space: 1, carry: 1 }],
    ]);
    expect(fake.state.windows.find((each) => each.id === 1)?.space).toBe(1);
    const snapshot = desktops.getSnapshot();
    expect(snapshot.fullscreen).toEqual([null, 1, null]);
    expect(snapshot.current).toBe(1);
    expect(snapshot.labels).toEqual(["Desktop 1", "App 1", "App 2"]);
    // settings.json still says two Desktops.
    expect(saved).toEqual([]);
    expect(fake.state.windows.find((each) => each.id === 2)?.space).toBe(2);
  });

  test("leaving: out of full screen where it is, carried back as its Desktop slides in, then its Desktop goes", async () => {
    const { fake, desktops, saved, toggle } = await desk([win(1, 0), win(2, 1)]);
    await toggle(1, true);
    fake.requests.length = 0;
    await toggle(1, false);
    expect(fake.moves()).toEqual([
      ["fullscreen", { window: 1, on: false }],
      ["space-switch", { space: 0, carry: 1 }],
      ["space-remove", { space: 1 }],
    ]);
    expect(desktops.getSnapshot().fullscreen).toEqual([null, null]);
    expect(desktops.getSnapshot().current).toBe(0);
    expect(fake.state.windows.map((each) => each.space)).toEqual([0, 1]);
    expect(saved).toEqual([]);
  });

  test("carried only once its app has drawn it at the new size", async () => {
    const { fake, toggle } = await desk([win(1, 0), win(2, 1)]);
    const game = fake.state.windows.find((each) => each.id === 1);
    if (!game) throw new Error("no window 1");
    game.configuring = { width: 1646, height: 937 };
    const clock = fakeClock();
    const carried = toggle(1, true);
    // The app is still drawing: the window waits where it is.
    await clock.advance(100, 10);
    expect(fake.requests.some(([method]) => method === "space-switch")).toBe(false);
    game.configuring = undefined;
    await clock.advance(100, 10);
    await carried;
    clock.restore();
    expect(fake.requests.some(([method]) => method === "space-switch")).toBe(true);
  });

  test("its dialogs come along, and go back with it", async () => {
    const { fake, toggle } = await desk([win(1, 0), win(3, 0, { parent: 1 })]);
    await toggle(1, true);
    expect(fake.state.windows.map((each) => each.space)).toEqual([1, 1]);
    await toggle(1, false);
    expect(fake.state.windows.map((each) => each.space)).toEqual([0, 0]);
  });

  test("closed while full screen: the screen slides back and its Desktop goes", async () => {
    const { fake, desktops, toggle } = await desk([win(1, 0), win(2, 1)]);
    await toggle(1, true);
    fake.state.windows = fake.state.windows.filter((each) => each.id !== 1);
    fake.emit({ event: "window-closed", id: 1 });
    await settle();
    expect(desktops.getSnapshot()).toMatchObject({ count: 2, current: 0, fullscreen: [null, null] });
  });

  test("minimized while full screen: out of full screen where it waits, and its Desktop goes", async () => {
    const { fake, desktops, toggle } = await desk([win(1, 0), win(2, 1)]);
    await toggle(1, true);
    fake.requests.length = 0;
    const game = fake.state.windows.find((each) => each.id === 1);
    if (game) game.state = "minimized";
    fake.emit({ event: "window-state", window: 1, state: "minimized" });
    await settle();
    expect(fake.moves()).toEqual([
      ["space-move", { window: 1, space: 0 }],
      ["fullscreen", { window: 1, on: false }],
      ["space-switch", { space: 0 }],
      ["space-remove", { space: 1 }],
    ]);
    expect(desktops.getSnapshot()).toMatchObject({ count: 2, current: 0, fullscreen: [null, null] });
  });

  test("its Desktop removed meanwhile: it goes back to the nearest one on the left", async () => {
    const { fake, desktops, toggle } = await desk([win(1, 1), win(2, 0)], 3, { ...SETTINGS, count: 3 });
    await toggle(1, true);
    expect(desktops.getSnapshot().fullscreen).toEqual([null, null, 1, null]);
    await desktops.remove(1);
    expect(desktops.getSnapshot().fullscreen).toEqual([null, 1, null]);
    await toggle(1, false);
    expect(fake.state.windows.find((each) => each.id === 1)?.space).toBe(0);
    expect(desktops.getSnapshot()).toMatchObject({ count: 2, current: 0, fullscreen: [null, null] });
  });

  test("the first Desktop removed: its windows skip the full-screen Desktop beside it", async () => {
    const { fake, desktops, toggle } = await desk([win(1, 0), win(2, 0)], 2);
    await toggle(1, true);
    await desktops.switchTo(0);
    await settle();
    await desktops.remove(0);
    // Desktop 2 (now the second Space) took them, not the game's.
    expect(fake.state.windows.find((each) => each.id === 2)?.space).toBe(1);
    expect(desktops.getSnapshot().fullscreen).toEqual([1, null]);
  });

  test("the last Desktop stays, and a full-screen Desktop's × takes its window out of full screen", async () => {
    const { desktops, toggle } = await desk([win(1, 0)], 1, { ...SETTINGS, count: 1 });
    await toggle(1, true);
    const left: number[] = [];
    desktops.leaveFullscreen = (window) => left.push(window);
    await desktops.remove(0);
    expect(desktops.getSnapshot().count).toBe(2);
    await desktops.remove(1);
    expect(left).toEqual([1]);
  });

  test("two full screen from one Desktop: each its own, in the order they came", async () => {
    const { desktops, toggle } = await desk([win(1, 0), win(2, 0), win(3, 1)]);
    await toggle(1, true);
    await toggle(2, true);
    expect(desktops.getSnapshot().fullscreen).toEqual([null, 1, 2, null]);
    await toggle(1, false);
    expect(desktops.getSnapshot().fullscreen).toEqual([null, 2, null]);
  });

  test("a new window while one shows opens on the Desktop it came from; the app's dialogs stay", async () => {
    const { desktops, fullscreen, toggle } = await desk([win(1, 0), win(4, 0, { parent: 1 })]);
    await toggle(1, true);
    expect(desktops.getSnapshot().current).toBe(1);
    expect(await fullscreen.spaceFor({ id: 9, appId: "other", title: "", width: 300, height: 200 })).toBe(0);
    expect(await fullscreen.spaceFor({ id: 9, appId: "game", title: "", width: 300, height: 200, parent: 1 })).toBeNull();
    // A dialog of its dialog stays too; a dialog of a window elsewhere does not.
    expect(await fullscreen.spaceFor({ id: 9, appId: "game", title: "", width: 300, height: 200, parent: 4 })).toBeNull();
    await desktops.switchTo(0);
    await settle();
    expect(await fullscreen.spaceFor({ id: 9, appId: "other", title: "", width: 300, height: 200 })).toBeNull();
  });

  test("a window put onto a full-screen Desktop goes back, and the overview's drop is refused", async () => {
    const { fake, desktops, toggle } = await desk([win(1, 0), win(2, 0)]);
    await toggle(1, true);
    await desktops.move(2, 1);
    expect(fake.requests.some(([method, params]) => method === "space-move" && params.window === 2)).toBe(false);
    // Activation brought it here (switchOnActivate off), or an agent did.
    await fake.compositor.request("space-move", { window: 2, space: 1 });
    await settle();
    expect(fake.state.windows.find((each) => each.id === 2)?.space).toBe(0);
    expect(desktops.getSnapshot().current).toBe(0);
    // Nor does the full-screen window leave its own.
    fake.requests.length = 0;
    await desktops.move(1, 2);
    expect(fake.requests).toEqual([]);
  });

  test("renaming skips it: names are by Desktop", async () => {
    const names: Array<(string | null)[]> = [];
    const fake = fakeCompositor([win(1, 0)], 2);
    const desktops = new SpacesController(fake.compositor as unknown as Compositor, () => {}, { saveNames: (each) => names.push(each) });
    desktops.start();
    await desktops.apply(SETTINGS);
    const fullscreen = new FullscreenDesktops({ compositor: fake.compositor as unknown as Compositor, desktops, slideWaitMs: 200 });
    fullscreen.start();
    await fullscreen.around(win(1, 0), true, () => fake.compositor.request("fullscreen", { window: 1, on: true }).then(() => {}));
    desktops.rename(1, "Nope");
    desktops.rename(2, "Second");
    expect(names).toEqual([[null, "Second"]]);
  });

  test("turned off, full screen stays on the Desktop it is on", async () => {
    const { fake, desktops, toggle } = await desk([win(1, 0)], 2, { ...SETTINGS, fullscreenDesktop: false });
    await toggle(1, true);
    expect(fake.moves()).toEqual([["fullscreen", { window: 1, on: true }]]);
    expect(desktops.getSnapshot().fullscreen).toEqual([null, null]);
  });

  test("after a restart of the shell: found again, not counted, and left as it is", async () => {
    const windows = [win(1, 0), win(2, 1, { fullscreen: true })];
    const { fake, desktops, saved, toggle } = await desk(windows, 3, { ...SETTINGS, count: 2 });
    expect(desktops.getSnapshot().fullscreen).toEqual([null, 2, null]);
    expect(desktops.getSnapshot().labels[1]).toBe("App 2");
    expect(fake.state.count).toBe(3);
    expect(saved).toEqual([]);
    await toggle(2, false);
    expect(desktops.getSnapshot()).toMatchObject({ count: 2, fullscreen: [null, null] });
    expect(fake.state.windows.find((each) => each.id === 2)?.space).toBe(0);
  });

  test("through the arranger: every way in and out goes around its Desktop", async () => {
    const { fake, desktops, fullscreen } = await desk([win(1, 0, { focused: true })]);
    const arranger = new Arranger(fake.compositor as unknown as Compositor);
    arranger.desktops = fullscreen;
    await arranger.start();
    // The app asks itself, as a game or a video player does.
    fake.emit({ event: "fullscreen", window: 1, on: true });
    await settle();
    expect(desktops.getSnapshot().fullscreen).toEqual([null, 1, null]);
    await arranger.toggleFullscreen(1);
    await settle();
    expect(desktops.getSnapshot().fullscreen).toEqual([null, null]);
    expect(fake.state.windows[0]?.fullscreen).toBeUndefined();
    // A new window while a full-screen Desktop shows is placed on the Desktop it came from.
    fake.emit({ event: "fullscreen", window: 1, on: true });
    await settle();
    fake.state.windows.push(win(5, 1));
    await arranger.place({ id: 5, appId: "other", title: "", width: 400, height: 300 });
    await settle();
    expect(fake.requests.find(([method, params]) => method === "place" && params.window === 5)?.[1]).toMatchObject({ space: 0 });
    expect(desktops.getSnapshot().current).toBe(0);
  });
});
