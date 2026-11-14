/**
 * The capsule's layer surface: one Metal host kept for the session with no
 * window, opened when something shows and hidden when nothing does, so the
 * dots are there as the key goes down (a new host takes seconds). The
 * surface spans the screen's width along its bottom edge, see-through, and
 * takes the pointer only on what is drawn (`input-region`). It takes no
 * keyboard: a card that is given it gets a second surface for its keys
 * (card-keys.tsx), so the card itself stays put. A layer surface's screen and
 * keyboard are fixed when it opens, so a change of either hides it and opens it again.
 * `shown` says what is wanted, not what the host has got to yet.
 */

import { type NativeHostOptions, type NativeHostTransport, type NativeRoot, render } from "@mirinjs/metal";
import type { ReactElement } from "react";
import { CAPSULE_LAYER } from "../../shared/pill/index.ts";
import { SURFACE_HEIGHT } from "./measures.ts";

/** A host that died is replaced after this long. */
const RESPAWN_MS = 1500;
/**
 * A resident host dies in its GPU layer when its window is hidden before it
 * has drawn (`ERROR_EXTENSION_NOT_PRESENT` at the next open: a key that
 * turned out to be a chord shows and hides the capsule in one breath), and
 * when it is opened in the same breath as it hid
 * (`ERROR_NATIVE_WINDOW_IN_USE_KHR`); both seen in the VM with mirin `main`.
 * So a window stays open at least `MIN_OPEN_MS` (drawing nothing by then),
 * and opens at least `REOPEN_MS` after it hid.
 */
export const MIN_OPEN_MS = 400;
export const REOPEN_MS = 150;

export interface SurfaceOptions {
  /** Start a host with no window (`deferred`). */
  spawn(options: NativeHostOptions): NativeHostTransport;
  /** What the surface draws; rendered once, for as long as the host lives. */
  element: ReactElement;
  /** The layer's name; the capsule's own unless said (the card's key surface, card-keys.tsx). */
  namespace?: string;
  /** The window was just opened. */
  opened?(): void;
  later?(fn: () => void, ms: number): unknown;
  /** A clock for the gap after a hide; `performance.now` unless a test says. */
  now?(): number;
}

/** The layer surface the capsule opens as, on `output`, with or without the keyboard. */
export function capsuleSurface(output: string | undefined, keyboard: boolean, namespace: string = CAPSULE_LAYER): NonNullable<NativeHostOptions["surface"]> {
  return {
    layer: "overlay",
    anchor: ["bottom", "left", "right"],
    // Measured from the screen's own edge, whatever the Dock keeps for itself.
    exclusiveZone: -1,
    keyboard: keyboard ? "exclusive" : "none",
    namespace,
    ...(output === undefined ? {} : { output }),
  };
}

export class CapsuleSurface {
  private host: NativeHostTransport | null = null;
  private root: NativeRoot | null = null;
  private open: { output: string | undefined; keyboard: boolean } | null = null;
  private wanted: { output: string | undefined; keyboard: boolean } | null = null;
  private stopped = false;
  private hiddenAt = Number.NEGATIVE_INFINITY;
  private openedAt = Number.NEGATIVE_INFINITY;
  private waiting = false;

  constructor(private readonly options: SurfaceOptions) {
    this.start();
  }

  /** Whether the window is open (it may be about to hide). */
  get shown(): boolean {
    return this.open !== null;
  }

  /** Show the surface on `output`; does nothing when it is already so. */
  show(output: string | undefined, keyboard: boolean): void {
    this.wanted = { output, keyboard };
    this.apply();
  }

  hide(): void {
    this.wanted = null;
    this.apply();
  }

  private now(): number {
    return this.options.now?.() ?? performance.now();
  }

  /** Bring the window to what is wanted now, waiting where the host needs time; what is wanted when the wait ends is what counts. */
  private apply(): void {
    const { host, open } = this;
    const wanted = this.wanted;
    if (!host || this.waiting) return;
    if (open && (!wanted || wanted.output !== open.output || wanted.keyboard !== open.keyboard)) {
      if (this.wait(this.openedAt + MIN_OPEN_MS)) return;
      host.hide();
      this.open = null;
      this.hiddenAt = this.now();
    }
    if (!wanted || this.open || this.wait(this.hiddenAt + REOPEN_MS)) return;
    host.open({
      title: "Dashi",
      appId: "dev.dashi.shell",
      width: 1,
      height: SURFACE_HEIGHT,
      surface: capsuleSurface(wanted.output, wanted.keyboard, this.options.namespace),
    });
    this.open = { ...wanted };
    this.openedAt = this.now();
    this.options.opened?.();
  }

  /** Come back to `apply` at `until` if that is still ahead; whether it is. */
  private wait(until: number): boolean {
    const ms = until - this.now();
    if (ms <= 0) return false;
    this.waiting = true;
    (this.options.later ?? setTimeout)(() => {
      this.waiting = false;
      this.apply();
    }, ms);
    return true;
  }

  private start(): void {
    if (this.host || this.stopped) return;
    const host = this.options.spawn({ appId: "dev.dashi.shell", deferred: true });
    this.host = host;
    this.root = render(this.options.element, host);
    host.onClose(() => {
      if (this.host !== host) return;
      this.host = null;
      this.open = null;
      this.hiddenAt = Number.NEGATIVE_INFINITY;
      this.root?.unmount();
      this.root = null;
      if (!this.stopped) (this.options.later ?? setTimeout)(() => this.start(), RESPAWN_MS);
    });
    this.apply();
  }

  close(): void {
    this.stopped = true;
    const { host, root } = this;
    this.host = null;
    this.open = null;
    root?.unmount();
    host?.close();
  }
}
