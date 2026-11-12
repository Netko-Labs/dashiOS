/**
 * A Metal host an applet keeps started with no window, for its popover and
 * its launcher views. A new host spends a second or two on its GPU context
 * and fonts before it can draw (longer in a VM), and a view's room in the
 * launcher stayed empty all that time; a host already started draws the view
 * on its first frame. One per applet that has a popover or a view, started a
 * few seconds after the applet, so it doesn't compete with the session
 * starting; taking it starts the next a moment later. An idle one is a few
 * megabytes of its own (the rest is the shared binary and libraries). A host
 * binary from before deferred hosts (`MIRIN_METAL_DEFERRED`) is never kept
 * warm: it would open a stray window.
 *
 * No host is started while the compositor isn't there (its socket refuses:
 * the session ended, or the compositor went and the sandbox still shows the
 * old socket): a host with no compositor panics, and one every 1.5 s filled
 * the journal. It looks again later instead, each time twice as long after
 * (up to `REWARM_MAX_MS`), and so does one whose host died before it was
 * taken; a host that is taken puts the wait back.
 */

import { join } from "node:path";
import { type NativeHostOptions, type NativeHostTransport, type NativeWindowOptions, spawnNativeHost } from "@mirinjs/metal";

export type Spawn = (binary: string, options: NativeHostOptions) => NativeHostTransport;

/** How long after the applet starts the first warm host starts. */
export const WARM_AFTER_MS = 3000;
/** How long after one is taken (or dies) the next starts, so the two don't compete. */
export const REWARM_MS = 1500;
/** The longest wait between tries while hosts fail to start (no compositor, a GPU that is gone). */
export const REWARM_MAX_MS = 5 * 60_000;

/** How long to wait after `failures` hosts in a row didn't last until they were taken. */
export function rewarmDelay(failures: number): number {
  return Math.min(REWARM_MS * 2 ** Math.min(failures, 16), REWARM_MAX_MS);
}

/** Timers, for tests. */
export interface WarmTimers {
  set(run: () => void, ms: number): unknown;
  clear(timer: unknown): void;
}

/** What `set` gave back: a timer of setTimeout's. */
const isTimer = (value: unknown): value is ReturnType<typeof setTimeout> => typeof value === "number" || (typeof value === "object" && value !== null);

const realTimers: WarmTimers = {
  set: (run, ms) => {
    const timer = setTimeout(run, ms);
    // A warm host never keeps the applet's process up by itself.
    timer.unref?.();
    return timer;
  },
  clear: (timer) => {
    if (isTimer(timer)) clearTimeout(timer);
  },
};

export interface WarmHostOptions {
  /** The host binary. */
  binary: string;
  /** The applet's name, what a screen reader calls its popover and views (`MIRIN_METAL_APP_NAME`). */
  appName: string;
  /** Whether the binary knows deferred hosts (`hostSupportsDeferred`). */
  supports?: (binary: string) => Promise<boolean>;
  /** Whether the compositor answers (`compositorIsThere`). */
  reachable?: () => Promise<boolean>;
  spawn?: Spawn;
  timers?: WarmTimers;
}

export class WarmHost {
  private spare: NativeHostTransport | null = null;
  private timer: unknown = null;
  private stopped = false;
  /** Hosts in a row that didn't start, or died before they were taken. */
  private failures = 0;
  private supported: Promise<boolean> | null = null;
  private readonly spawn: Spawn;
  private readonly timers: WarmTimers;

  constructor(private readonly options: WarmHostOptions) {
    this.spawn = options.spawn ?? spawnNativeHost;
    this.timers = options.timers ?? realTimers;
  }

  /** Start keeping one warm, `WARM_AFTER_MS` from now. */
  start(): void {
    this.later(WARM_AFTER_MS);
  }

  /** The warm host with its window opened as `window`, or null when none is ready. */
  take(window: NativeWindowOptions): NativeHostTransport | null {
    const host = this.spare;
    if (!host || this.stopped) return null;
    this.spare = null;
    this.failures = 0;
    host.open(window);
    this.later(REWARM_MS);
    return host;
  }

  /** Whether one is ready to take (tests). */
  isReady(): boolean {
    return this.spare !== null;
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
    this.spare?.close();
    this.spare = null;
  }

  private later(ms: number): void {
    if (this.timer !== null || this.stopped) return;
    this.timer = this.timers.set(() => {
      this.timer = null;
      void this.warm();
    }, ms);
  }

  private async warm(): Promise<void> {
    this.supported ??= (this.options.supports ?? hostSupportsDeferred)(this.options.binary).catch(() => false);
    if (!(await this.supported) || this.spare || this.stopped) return;
    if (!(await (this.options.reachable ?? compositorIsThere)().catch(() => false))) {
      if (!this.stopped) this.later(rewarmDelay(++this.failures));
      return;
    }
    if (this.spare || this.stopped) return;
    const host = this.spawn(this.options.binary, {
      deferred: true,
      env: { MIRIN_METAL_APP_NAME: this.options.appName },
    });
    this.spare = host;
    // One that dies (a crash, a GPU reset) is replaced, not handed out.
    host.onClose(() => {
      if (this.spare !== host) return;
      this.spare = null;
      this.later(rewarmDelay(this.failures++));
    });
  }
}

/** Whether the host binary knows deferred windows: it names `MIRIN_METAL_DEFERRED`. */
export async function hostSupportsDeferred(binary: string): Promise<boolean> {
  try {
    const grep = Bun.spawn(["grep", "-aqF", "MIRIN_METAL_DEFERRED", binary], { stdout: "ignore", stderr: "ignore" });
    return (await grep.exited) === 0;
  } catch {
    return false;
  }
}

/**
 * Whether the compositor answers on its Wayland socket. A socket file whose
 * compositor is gone refuses the connection. With no display named, the host
 * is left to find one.
 */
export async function compositorIsThere(env: Readonly<Record<string, string | undefined>> = process.env): Promise<boolean> {
  const display = env.WAYLAND_DISPLAY;
  if (!display) return true;
  const path = display.startsWith("/") ? display : join(env.XDG_RUNTIME_DIR ?? "/run/user/0", display);
  try {
    const socket = await Bun.connect({ unix: path, socket: { data() {} } });
    socket.end();
    return true;
  } catch {
    return false;
  }
}
