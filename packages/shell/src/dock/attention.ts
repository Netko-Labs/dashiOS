/**
 * Apps that asked for attention: a window wanted focus and the compositor
 * refused it (no focus stealing, comp/src/handlers/activation_policy.rs),
 * so the Dock marks its app until one of its windows is focused, as macOS
 * bounces the icon. Kept by app (the IPC's window numbers and the Dock's
 * toplevel ids are different spaces; the app id is shared).
 */

import type { Toplevel } from "@mirinjs/metal";
import { useSyncExternalStore } from "react";
import type { Compositor, CompositorEvent } from "../compositor.ts";
import type { Entry } from "../entries.ts";
import { appKey } from "./layout.ts";

const NONE: ReadonlySet<string> = new Set();

export class AttentionStore {
  private keys: ReadonlySet<string> = NONE;
  private readonly listeners = new Set<() => void>();
  private readonly stops: Array<() => void> = [];

  constructor(
    private readonly deps: {
      compositor: Pick<Compositor, "on" | "windows">;
      catalog: readonly Entry[];
      toplevels: { getSnapshot(): readonly Toplevel[]; subscribe(listener: () => void): () => void };
    },
  ) {
    this.stops.push(deps.compositor.on((event) => void this.heard(event)));
    this.stops.push(deps.toplevels.subscribe(() => this.focused()));
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ReadonlySet<string> => this.keys;

  close(): void {
    for (const stop of this.stops) stop();
  }

  private async heard(event: CompositorEvent): Promise<void> {
    if (event.event !== "window-attention") return;
    const window = (await this.deps.compositor.windows().catch(() => [])).find((each) => each.id === event.window);
    // An app that is focused already needs no mark.
    if (!window || window.focused) return;
    const key = appKey(this.deps.catalog, { id: -window.id, appId: window.appId });
    if (!this.keys.has(key)) this.set(new Set([...this.keys, key]));
  }

  /** A window of a marked app got focus: its mark goes. */
  private focused(): void {
    if (this.keys.size === 0) return;
    const active = this.deps.toplevels
      .getSnapshot()
      .filter((window) => window.activated)
      .map((window) => appKey(this.deps.catalog, window));
    const next = new Set([...this.keys].filter((key) => !active.includes(key)));
    if (next.size !== this.keys.size) this.set(next);
  }

  private set(keys: ReadonlySet<string>): void {
    this.keys = keys;
    for (const listener of this.listeners) listener();
  }
}

export function useAttention(store: AttentionStore | null): ReadonlySet<string> {
  return useSyncExternalStore(store?.subscribe ?? (() => () => {}), store?.getSnapshot ?? (() => NONE));
}
