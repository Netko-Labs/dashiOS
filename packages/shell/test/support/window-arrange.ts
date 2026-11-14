/**
 * Shared set-up for the window arrangement tests: the VM's screen, a frame helper, a fake compositor
 * that answers frames and full screen (a lagging app when asked), and the window the tests arrange.
 */

import { Arranger } from "../../src/arrange/arrange.ts";
import type { Compositor } from "../../src/compositor/client.ts";
import type { CompositorEvent } from "../../src/compositor/events.ts";
import type { CompositorWindow } from "../../src/compositor/wire.ts";
import type { Rect } from "../../src/layout.ts";
import { fakeCompositor, listening } from "./compositor.ts";
import { flush } from "./time.ts";

/** The VM's screen: 1646 × 937 points, the menu bar (28) and the Dock (65 + 6) leaving 838 between them. */
export const SCREEN: Rect = { x: 0, y: 0, width: 1646, height: 937 };
export const USABLE: Rect = { x: 0, y: 28, width: 1646, height: 838 };
export const rect = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });

/** The fake compositor as the typed methods see it: its `on` and its `windows`. */
type FakeCompositor = ReturnType<typeof fakeCompositor<{ on: Compositor["on"]; windows: () => Promise<CompositorWindow[]> }>>;

/**
 * A compositor holding `windows`, carrying out `frame` and `fullscreen`, and
 * keeping what it was asked. As dashi-comp does, full screen says
 * `outputs-changed` while it is asked; leaving, the app still draws at the
 * screen's size for a while (where its old frame was), and `configuring`
 * says the size it was asked to take. With `lag`, an app is slow as a busy
 * Metal app is: a frame moves the window at once, but its size changes only
 * at `catchUp()`, and until then `configuring` says what it will be.
 */
export function fake(
  windows: Array<CompositorWindow & { before?: Rect | null }>,
  outputs: Array<{ name: string; frame: Rect; usable: Rect }> = [{ name: "Virtual-1", frame: SCREEN, usable: USABLE }],
  lag = false,
): {
  compositor: FakeCompositor;
  requests: Array<[string, Record<string, unknown>]>;
  frames: () => Array<[string, Record<string, unknown>]>;
  emit: (event: CompositorEvent) => Promise<void>;
  catchUp: () => void;
} {
  const requests: Array<[string, Record<string, unknown>]> = [];
  const events = listening();
  const compositor = fakeCompositor(
    async (method, params = {}) => {
      requests.push([method, params]);
      if (method === "outputs") return { outputs: outputs.map((output) => ({ ...output, scale: 1 })) };
      const window = windows.find((candidate) => candidate.id === params.window);
      if (window && method === "frame") {
        const size = { width: Number(params.width), height: Number(params.height) };
        const drawn = lag && window.frame ? { width: window.frame.width, height: window.frame.height } : size;
        window.frame = { x: Number(params.x), y: Number(params.y), ...drawn };
        if (lag) window.configuring = size;
        else delete window.configuring;
      }
      if (window && method === "fullscreen") {
        const on = params.on === true;
        if (on) window.before = window.frame;
        window.fullscreen = on;
        window.frame = on ? { ...SCREEN } : { x: window.before?.x ?? 0, y: window.before?.y ?? 0, width: SCREEN.width, height: SCREEN.height };
        if (on) delete window.configuring;
        else if (window.before) window.configuring = { width: window.before.width, height: window.before.height };
        events.emit({ event: "outputs-changed" });
      }
      return {};
    },
    {
      on: events.on,
      windows: async () => windows.map(({ before: _, ...window }) => ({ ...window })),
    },
  );
  const frames = () => requests.filter(([method]) => method === "frame" || method === "fullscreen");
  const emit = async (event: CompositorEvent) => {
    events.emit(event);
    await flush();
  };
  /** The apps draw at the sizes they were asked for. */
  const catchUp = () => {
    for (const window of windows) {
      if (window.configuring && window.frame) window.frame = { ...window.frame, ...window.configuring };
      delete window.configuring;
    }
  };
  return { compositor, requests, frames, emit, catchUp };
}

export const OWN = rect(300, 200, 800, 600);
export const files = (): CompositorWindow => ({
  id: 7,
  appId: "dev.dashi.files",
  title: "Files",
  pid: 9,
  focused: true,
  state: "normal",
  frame: { ...OWN },
  titleBar: 0,
});

type Started = ReturnType<typeof fake> & { arranger: Arranger; window: CompositorWindow };

export async function started(window = files(), outputs?: Parameters<typeof fake>[1], lag = false): Promise<Started> {
  const world = fake([window], outputs, lag);
  const arranger = new Arranger(world.compositor);
  await arranger.start();
  world.requests.length = 0;
  return { ...world, arranger, window };
}
