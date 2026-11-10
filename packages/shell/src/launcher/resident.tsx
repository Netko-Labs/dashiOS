/**
 * The launcher's own Metal host, kept for the session and shown and hidden
 * (docs/betterments.html, Speed, B): a ❖ tap opens a window on a host whose
 * GPU context, fonts and React root are already there, so a second tap a
 * moment after the first is as quick as the first, and neither touches the
 * disk. It needs a host that can hide its window and open it again (mirin's
 * resident deferred hosts: the binary names `MIRIN_METAL_RESIDENT`); with an
 * older one `open` says no and the launcher opens as other overlays do
 * (overlay.tsx).
 *
 * Each open mounts the launcher afresh (a new key: an empty field), waits for
 * that tree to be committed, and then opens the window, so its first frame is
 * that tree. Hiding unmounts it, so nothing of it runs while it is hidden. A
 * host that dies is replaced a moment later; one that dies while shown is a
 * close.
 */

import { TextSelectionLook } from "@dashi/ui";
import { type NativeHostOptions, type NativeHostTransport, type NativeRoot, type NativeWindowOptions, render, spawnNativeHost } from "@mirinjs/metal";
import { type ReactElement, useEffect, useSyncExternalStore } from "react";
import type { OverlayHandle } from "../overlay.tsx";
import { shellHostOptions } from "../shared/metal/host.ts";

type Spawn = (binary: string, options: NativeHostOptions) => NativeHostTransport;

/**
 * The launcher's motion (docs/design.html, Motion): it fades in from 0.96 of its size over
 * 160 ms (the compositor's `layer-motion`), and its list follows its rows' height over 120 ms
 * (a resident host's `heightTransitionMs`), both ease-out cubic, both off with Reduce Motion.
 */
export const LAUNCHER_MOTION = { namespace: "dashi.launcher", openMs: 160, fromScale: 0.96, heightMs: 120 } as const;

/** What a host binary that can hide and open again names. */
export const RESIDENT_MARKER = "MIRIN_METAL_RESIDENT";
/** A host that died is replaced after this long. */
const RESPAWN_MS = 1500;

/** Whether the host binary keeps a deferred host resident: it names `MIRIN_METAL_RESIDENT`. */
export async function hostIsResident(binary: string): Promise<boolean> {
  const grep = Bun.spawn(["grep", "-aqF", RESIDENT_MARKER, binary], { stdout: "ignore", stderr: "ignore" });
  return (await grep.exited) === 0;
}

/** The one element the resident root shows, and the commits that show it. */
class Slot {
  private element: { key: number; element: ReactElement } | null = null;
  private readonly listeners = new Set<() => void>();
  private committed: { key: number; resolve: () => void } | null = null;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly snapshot = (): { key: number; element: ReactElement } | null => this.element;

  /** Show `element` (null: nothing); resolves once the root has committed it. */
  set(element: ReactElement | null, key: number): Promise<void> {
    this.element = element ? { key, element } : null;
    const done = new Promise<void>((resolve) => {
      this.committed?.resolve();
      this.committed = { key, resolve };
    });
    for (const listener of this.listeners) listener();
    return done;
  }

  /** The root committed what `key` showed. */
  commit(key: number): void {
    if (this.committed?.key !== key) return;
    this.committed.resolve();
    this.committed = null;
  }
}

function SlotView({ slot }: { slot: Slot }) {
  const shown = useSyncExternalStore(slot.subscribe, slot.snapshot);
  const key = shown?.key ?? 0;
  useEffect(() => slot.commit(key), [slot, key]);
  return shown ? <Wrapper key={shown.key}>{shown.element}</Wrapper> : null;
}

/** Keys the element, so each open starts from nothing. */
function Wrapper({ children }: { children: ReactElement }): ReactElement {
  return children;
}

/** The window part of an overlay's options. */
const windowOf = ({ title, appId, width, height, surface, titleBar }: NativeHostOptions): NativeWindowOptions => ({
  title,
  appId: appId ?? "dev.dashi.shell",
  width,
  height,
  surface,
  titleBar,
});

/** Hide a resident host's window: `hide()` on a transport that has it, else its line. */
function hideWindow(host: NativeHostTransport): void {
  const hide: unknown = Reflect.get(host, "hide");
  if (typeof hide === "function") hide.call(host);
  else host.send('{"hide":true}');
}

export interface ResidentOptions {
  /** Whether the binary keeps hosts resident (`hostIsResident`). */
  supports?: (binary: string) => Promise<boolean>;
  spawn?: Spawn;
  /** Hears each open's first frame, ms after `open` was asked (the timing log). */
  onFrame?: (ms: number) => void;
}

export class ResidentHost {
  private host: NativeHostTransport | null = null;
  private root: NativeRoot | null = null;
  private readonly slot = new Slot();
  private readonly supported: Promise<boolean>;
  private isSupported = false;
  private shown: { key: number; onClosed: (() => void) | undefined; openedAt: number | null } | null = null;
  private opens = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(
    private readonly binary: string,
    private readonly options: ResidentOptions = {},
  ) {
    this.supported = (options.supports ?? hostIsResident)(binary).catch(() => false);
    void this.supported.then((ok) => {
      this.isSupported = ok;
      if (ok) this.start();
    });
  }

  /** Resolves once it is known whether the launcher is resident (tests). */
  ready(): Promise<boolean> {
    return this.supported;
  }

  /** Whether `open` would show now: the host is resident and up. */
  isReady(): boolean {
    return this.isSupported && this.host !== null && !this.stopped;
  }

  /** Whether the window is shown now. */
  isShown(): boolean {
    return this.shown !== null;
  }

  /**
   * Show `element` in a window opened as `options` say, or null when there is
   * no resident host (the caller opens it another way). `onClosed` runs once,
   * however it went.
   */
  open(options: NativeHostOptions, element: ReactElement, onClosed?: () => void): OverlayHandle | null {
    const host = this.host;
    if (!this.isReady() || !host || this.shown) return null;
    const key = ++this.opens;
    const shown = { key, onClosed, openedAt: this.options.onFrame ? performance.now() : null };
    this.shown = shown;
    void this.slot.set(element, key).then(() => {
      // Closed before the tree was committed, or the host went: nothing to open.
      if (this.shown !== shown || this.host !== host) return;
      host.open(windowOf(options));
    });
    // No `exited`: the host stays up when the window hides, so there is no exit to wait for.
    return { close: () => this.hide(key) };
  }

  /** Hide the window that open `key` showed (a later open is left alone). */
  private hide(key: number): void {
    const shown = this.shown;
    if (!shown || shown.key !== key) return;
    this.shown = null;
    void this.slot.set(null, 0);
    if (this.host) hideWindow(this.host);
    shown.onClosed?.();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    const shown = this.shown;
    this.shown = null;
    this.root?.unmount();
    this.root = null;
    this.host?.close();
    this.host = null;
    shown?.onClosed?.();
  }

  private start(): void {
    if (this.host || this.stopped) return;
    const host = (this.options.spawn ?? spawnNativeHost)(this.binary, shellHostOptions({ appId: "dev.dashi.shell", deferred: true }));
    this.host = host;
    this.root = render(
      <TextSelectionLook>
        <SlotView slot={this.slot} />
      </TextSelectionLook>,
      host,
    );
    host.onEvent((event) => {
      const kind: string = event.type;
      const shown = this.shown;
      if (kind === "frame" && shown?.openedAt != null) {
        this.options.onFrame?.(performance.now() - shown.openedAt);
        shown.openedAt = null;
      }
    });
    host.onClose(() => {
      if (this.host !== host) return;
      this.host = null;
      this.root?.unmount();
      this.root = null;
      // Shown when it went (a crash, the compositor closed it): that is a close.
      const shown = this.shown;
      this.shown = null;
      void this.slot.set(null, 0);
      shown?.onClosed?.();
      if (!this.stopped) this.timer = setTimeout(() => this.restart(), RESPAWN_MS);
    });
  }

  private restart(): void {
    this.timer = null;
    this.start();
  }
}
