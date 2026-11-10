/**
 * A compositor for tests: the typed methods (src/compositor.ts `callsOf`)
 * over a fake `request`, so a test can answer by method name and see what
 * was sent, params checked and replies parsed as the real client does.
 */

import { type Compositor, type CompositorEvent, callsOf } from "../../src/compositor.ts";

export type FakeRequest = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

/** The typed methods over `request`, with `extra` (an `on`, a `windows`…) taking precedence. */
export function fakeCompositor<E extends Partial<Compositor>>(request: FakeRequest, extra?: E): Pick<Compositor, "request"> & ReturnType<typeof callsOf> & E {
  return Object.assign(
    { request },
    callsOf((method, params) => request(method, params)),
    extra ?? ({} as E),
  );
}

/** An `on` that keeps its listeners, and `emit`, which tells them an event. */
export function listening(): { on: Compositor["on"]; emit: (event: CompositorEvent) => void } {
  const listeners = new Set<(event: CompositorEvent) => void>();
  return {
    on: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit: (event) => {
      for (const listener of [...listeners]) listener(event);
    },
  };
}
