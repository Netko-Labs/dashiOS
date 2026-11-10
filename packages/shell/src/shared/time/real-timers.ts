/** The platform's timers, for code that takes timers so a test can hand in its own. */

type Timeout = ReturnType<typeof setTimeout>;

export interface Timers {
  set(callback: () => void, ms: number): unknown;
  /** Stops a handle `set` gave; anything else is left alone. */
  clear(handle: unknown): void;
}

const isTimeout = (handle: unknown): handle is Timeout => typeof handle === "object" && handle !== null && "hasRef" in handle;

export const realTimers: Timers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => {
    if (isTimeout(handle)) clearTimeout(handle);
  },
};
