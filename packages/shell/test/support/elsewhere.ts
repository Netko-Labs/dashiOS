/** A desk for the tests of an agent at work on another Desktop: Desktops and a compositor that keep the Spaces as plain numbers. */

import type { RunContext, ToolResult } from "../../src/agents/context.ts";
import { type AgentSpaces, Elsewhere, WorkPlaces } from "../../src/agents/desktop/elsewhere.ts";
import type { CompositorEvent } from "../../src/compositor/events.ts";
import type { CompositorWindow } from "../../src/compositor/index.ts";
import { Followed } from "../../src/spaces/lib/followed.ts";
import { MAX_SPACES } from "../../src/spaces/model.ts";
import { listening } from "./compositor.ts";

export const window = (id: number, space: number, more: Partial<CompositorWindow> = {}): CompositorWindow => ({
  id,
  appId: "dev.dashi.textedit",
  title: `Window ${id}`,
  pid: 100 + id,
  focused: false,
  state: "normal",
  frame: null,
  titleBar: 0,
  space,
  ...more,
});

export function desk(count = 2, windows: CompositorWindow[] = []) {
  const state = { count, current: 0, fullscreen: Array.from({ length: count }, (): number | null => null), windows };
  const followed = new Followed();
  const quiet: number[][] = [];
  const focused: Array<Record<string, unknown>> = [];
  const events = listening();
  const spaces: AgentSpaces = {
    getSnapshot: () => ({
      count: state.count,
      current: state.current,
      labels: Array.from({ length: state.count }, (_, index) => `Desktop ${index + 1}`),
      fullscreen: state.fullscreen,
    }),
    add: async () => {
      if (state.count >= MAX_SPACES) return null;
      state.fullscreen.push(null);
      return state.count++;
    },
    remove: async (index) => {
      state.count--;
      state.fullscreen.splice(index, 1);
      followed.removed(index);
    },
    follow: (index) => followed.follow(index),
    unfollow: (ref) => followed.unfollow(ref),
  };
  const compositor = {
    windows: async () => state.windows,
    spaces: async (params: { quiet?: number[] } = {}) => {
      if (params.quiet) quiet.push(params.quiet);
      return { count: state.count, current: state.current };
    },
    focus: async (params: Record<string, unknown>) => {
      focused.push(params);
      return {};
    },
    on: events.on,
  };
  const places = new WorkPlaces(
    compositor as never,
    () => spaces,
    (pid, ancestor) => pid === ancestor + 1,
  );
  const said: string[] = [];
  const elsewhere = new Elsewhere(places);
  const ctx = {
    compositor,
    elsewhere,
    desktop: { spaces },
    status: (words: string) => said.push(words),
    mayName: () => true,
    arrangement: () => null,
  } as unknown as RunContext;
  const emit = (event: CompositorEvent) => events.emit(event);
  return { state, spaces, places, elsewhere, ctx, said, quiet, focused, followed, emit };
}

export const words = (result: ToolResult): string => result.content.map((part) => (part.type === "text" ? part.text : "")).join(" ");
