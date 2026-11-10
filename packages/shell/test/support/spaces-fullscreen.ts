/**
 * Shared set-up for the full-screen Desktops tests: the screen and its usable area, a window, and a
 * compositor that keeps Spaces as dashi-comp does, with the controller and full screen on it.
 */

import type { Compositor, CompositorWindow } from "../../src/compositor.ts";
import type { Rect } from "../../src/layout.ts";
import { FullscreenDesktops } from "../../src/spaces/fullscreen.ts";
import { SpacesController } from "../../src/spaces/lib/controller.ts";
import type { SpacesSettings } from "../../src/spaces/lib/state.ts";
import { listening, fakeCompositor as over } from "./compositor.ts";
import { settle } from "./time.ts";

export const SCREEN: Rect = { x: 0, y: 0, width: 1646, height: 937 };
export const USABLE: Rect = { x: 0, y: 28, width: 1646, height: 838 };

export const win = (id: number, space: number, more: Partial<CompositorWindow> = {}): CompositorWindow => ({
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

type Window = CompositorWindow;

/** The fake compositor as the typed methods see it: its `on` and its `windows`. */
type FakeCompositor = ReturnType<typeof over<{ on: Compositor["on"]; windows: () => Promise<CompositorWindow[]> }>>;

/**
 * A compositor that keeps Spaces as dashi-comp does: each window's Space,
 * `space-add {at}` moving the later ones up, `space-remove` giving a Space's
 * windows to the one on its left (the first's to the second), switches (the
 * `space` event a little later, as a slide ends), full screen, and a window
 * placed on a Space. Every request is kept, in order.
 */
export function fakeCompositor(
  windows: Window[],
  count = 1,
): {
  compositor: FakeCompositor;
  state: { count: number; current: number; windows: Window[] };
  requests: Array<[string, Record<string, unknown>]>;
  emit: ReturnType<typeof listening>["emit"];
  moves: () => (string | Record<string, unknown>)[][];
} {
  const events = listening();
  const requests: Array<[string, Record<string, unknown>]> = [];
  const state = { count, current: 0, windows };
  const emit = events.emit;
  const moved = (window: Window, space: number) => {
    window.space = space;
    emit({ event: "window-space", window: window.id, space });
  };
  const answer = () => ({ count: state.count, current: state.current });
  const spaceEvent = (previous: number) => emit({ event: "space", current: state.current, previous, count: state.count });
  const request = async (method: string, params: Record<string, unknown> = {}): Promise<unknown> => {
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
  };
  const compositor = over(request, {
    on: events.on,
    windows: async () => state.windows.map((window) => ({ ...window })),
  });
  return {
    compositor,
    state,
    requests,
    emit,
    /** The requests that change Spaces or full screen, in order. */
    moves: () => requests.filter(([method]) => method.startsWith("space-") || method === "fullscreen").map(([method, params]) => [method, params]),
  };
}

export const SETTINGS: SpacesSettings = { count: 2, switchOnActivate: true, fullscreenDesktop: true };

export type Desk = {
  fake: ReturnType<typeof fakeCompositor>;
  desktops: SpacesController;
  fullscreen: FullscreenDesktops;
  saved: number[];
  toggle: (id: number, on: boolean) => Promise<void>;
};

/** The Spaces controller and the full-screen Desktops on a fake, settings applied. */
export async function desk(windows: Window[], count = 2, settings: SpacesSettings = SETTINGS): Promise<Desk> {
  const fake = fakeCompositor(windows, count);
  const saved: number[] = [];
  const desktops = new SpacesController(fake.compositor, (each) => saved.push(each), {
    appName: (window) => `App ${window.id}`,
  });
  desktops.start();
  await desktops.apply(settings);
  const fullscreen = new FullscreenDesktops({ compositor: fake.compositor, desktops, slideWaitMs: 200 });
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
