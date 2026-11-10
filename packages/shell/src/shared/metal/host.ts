/**
 * The shell's own Metal hosts: every surface the shell draws (the menu bar,
 * the Dock, the launcher, sheets, banners, the lock screen) is "Dashi" to a
 * screen reader, not the host binary's file name (`MIRIN_METAL_APP_NAME`,
 * mirin's `appName`). Only the shell's hosts get the name: it is never put
 * in the shell's own environment, which apps and terminals inherit.
 */

import { type NativeHostOptions, type NativeHostTransport, type NativeWindowOptions, spawnNativeHost } from "@mirinjs/metal";
import { METAL_HOST } from "../apps/list.ts";

/** What Orca says for the shell's surfaces. */
export const SHELL_APP_NAME = "Dashi";

/** The environment that names a host for screen readers; a host from before it ignores it. */
export function appNameEnv(name: string): Record<string, string> {
  return { MIRIN_METAL_APP_NAME: name };
}

/** `options` for one of the shell's hosts: named Dashi, keeping any environment the caller gave. */
export function shellHostOptions(options: NativeHostOptions): NativeHostOptions {
  return { ...options, env: { ...appNameEnv(SHELL_APP_NAME), ...options.env } };
}

/** Spawn one of the shell's hosts (`METAL_HOST` unless `binary` says otherwise). */
export function spawnShellHost(options: NativeHostOptions, binary: string = METAL_HOST): NativeHostTransport {
  return spawnNativeHost(binary, shellHostOptions(options));
}

// A Metal host kept started with no window, so the next menu, sheet, or the
// launcher shows at once: a new host spends seconds on its GPU context and
// fonts before it can draw (mirin's deferred hosts, `MIRIN_METAL_DEFERRED`).
// Taking it starts the next one a moment later. A host binary from before
// deferred hosts is never kept warm: it would open a stray window.

type Spawn = (binary: string, options: NativeHostOptions) => NativeHostTransport;

/** How long after one is taken the next warm host starts, so the two don't compete. */
const REWARM_MS = 1500;

export class WarmHost {
  private spare: NativeHostTransport | null = null;
  private supported: Promise<boolean>;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(
    private readonly binary: string,
    supports: (binary: string) => Promise<boolean> = hostSupportsDeferred,
    private readonly spawn: Spawn = spawnNativeHost,
  ) {
    this.supported = supports(binary).catch(() => false);
    void this.supported.then((ok) => {
      if (ok) this.warm();
    });
  }

  /** Resolves once it is known whether hosts are kept warm (tests). */
  ready(): Promise<boolean> {
    return this.supported;
  }

  /** The warm host with its window opened as `window`, or null when there is none ready. */
  take(window: NativeWindowOptions): NativeHostTransport | null {
    const host = this.spare;
    if (!host) return null;
    this.spare = null;
    host.open(window);
    this.later();
    return host;
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.spare?.close();
    this.spare = null;
  }

  private later(): void {
    if (this.timer || this.stopped) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.warm();
    }, REWARM_MS);
  }

  private warm(): void {
    if (this.spare || this.stopped) return;
    const host = this.spawn(this.binary, shellHostOptions({ appId: "dev.dashi.shell", deferred: true }));
    this.spare = host;
    // A warm host that dies (a crash, a GPU reset) is replaced, not handed out.
    host.onClose(() => {
      if (this.spare === host) {
        this.spare = null;
        this.later();
      }
    });
  }
}

/** Whether the host binary knows deferred windows: it names `MIRIN_METAL_DEFERRED`. */
export function hostSupportsDeferred(binary: string): Promise<boolean> {
  return binaryNames(binary, "MIRIN_METAL_DEFERRED");
}

/**
 * Whether the host binary's `open` takes a least size: it names
 * `MIRIN_METAL_OPEN_MIN_SIZE`. A host from before refuses an open line with
 * `minWidth` in it, and no window opens at all.
 */
export function hostTakesLeast(binary: string): Promise<boolean> {
  return binaryNames(binary, "MIRIN_METAL_OPEN_MIN_SIZE");
}

async function binaryNames(binary: string, marker: string): Promise<boolean> {
  const grep = Bun.spawn(["grep", "-aqF", marker, binary], {
    stdout: "ignore",
    stderr: "ignore",
  });
  return (await grep.exited) === 0;
}

/**
 * The window part of a host's options, for a warm host's `open`: its least
 * size only when the host takes it (`hostTakesLeast`) and both sizes are set.
 */
export function windowFor(
  { title, appId, width, height, minWidth, minHeight, surface, titleBar }: NativeHostOptions,
  takesLeast: boolean,
): NativeWindowOptions {
  const least = takesLeast && minWidth !== undefined && minHeight !== undefined ? { minWidth, minHeight } : {};
  return { title, appId, width, height, ...least, surface, titleBar };
}
