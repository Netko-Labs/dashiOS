/**
 * The capsule's layer surface: one Metal host kept for the session with no
 * window, opened when something shows and hidden when nothing does, so the
 * dots are there as the key goes down (a new host takes seconds). The
 * surface spans the screen's width along its bottom edge, see-through, and
 * takes the pointer only on what is drawn (`input-region`). It takes no
 * keyboard, until a card is given it. A layer surface's screen and keyboard
 * are fixed when it opens, so a change of either hides it and opens it again.
 */

import { type NativeHostOptions, type NativeHostTransport, type NativeRoot, render } from "@mirinjs/metal";
import type { ReactElement } from "react";
import { CAPSULE_LAYER } from "../../shared/pill/index.ts";
import { SURFACE_HEIGHT } from "./measures.ts";

/** A host that died is replaced after this long. */
const RESPAWN_MS = 1500;

export interface SurfaceOptions {
  /** Start a host with no window (`deferred`). */
  spawn(options: NativeHostOptions): NativeHostTransport;
  /** What the surface draws; rendered once, for as long as the host lives. */
  element: ReactElement;
  later?(fn: () => void, ms: number): unknown;
}

/** The layer surface the capsule opens as, on `output`, with or without the keyboard. */
export function capsuleSurface(output: string | undefined, keyboard: boolean): NonNullable<NativeHostOptions["surface"]> {
  return {
    layer: "overlay",
    anchor: ["bottom", "left", "right"],
    // Measured from the screen's own edge, whatever the Dock keeps for itself.
    exclusiveZone: -1,
    keyboard: keyboard ? "exclusive" : "none",
    namespace: CAPSULE_LAYER,
    ...(output === undefined ? {} : { output }),
  };
}

export class CapsuleSurface {
  private host: NativeHostTransport | null = null;
  private root: NativeRoot | null = null;
  private open: { output: string | undefined; keyboard: boolean } | null = null;
  private wanted: { output: string | undefined; keyboard: boolean } | null = null;
  private stopped = false;

  constructor(private readonly options: SurfaceOptions) {
    this.start();
  }

  /** Whether the window is on screen. */
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

  private apply(): void {
    const { host, open } = this;
    const wanted = this.wanted;
    if (!host) return;
    if (open && (!wanted || wanted.output !== open.output || wanted.keyboard !== open.keyboard)) {
      host.hide();
      this.open = null;
    }
    if (wanted && !this.open) {
      host.open({ title: "Dashi", appId: "dev.dashi.shell", width: 1, height: SURFACE_HEIGHT, surface: capsuleSurface(wanted.output, wanted.keyboard) });
      this.open = { ...wanted };
    }
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
