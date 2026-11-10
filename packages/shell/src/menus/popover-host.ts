/**
 * The one surface the popovers share: it opens on the first popover, swaps
 * what it shows for the next, moves to another screen, and closes with the
 * last. What the popovers are (menus, panels, the bar's keyboard) is the
 * controller's (controller.ts).
 */

import type { OverlayHandle } from "../overlay.tsx";
import { stopOfPopover } from "./bar-keys.ts";
import type { ControllerDeps, MenuState, Popover } from "./controller-types.ts";

export const CLOSED: MenuState = { popover: null, appName: null, context: null };

export class PopoverHost {
  protected state: MenuState = CLOSED;
  protected surface: OverlayHandle | null = null;
  /** Bumped by every open and close, so a slow `context` cannot reopen what was closed. */
  protected generation = 0;
  /** The stop being opened from the keyboard, so what opens keeps the ring on it. */
  protected opening: string | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(protected readonly deps: ControllerDeps) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): MenuState => this.state;

  close(): void {
    this.generation++;
    const surface = this.surface;
    this.surface = null;
    this.set(CLOSED);
    surface?.close();
  }

  protected async show(popover: Popover, appName: string, output?: string): Promise<void> {
    if (this.surface) {
      if (!this.isOn(output)) return this.relocate(popover, output);
      // With the keyboard in the bar, the ring goes to what opened (a click elsewhere in the bar moves it too).
      const bar = this.state.bar === undefined ? {} : { bar: this.opening ?? stopOfPopover(popover) ?? this.state.bar };
      this.set({ ...this.state, popover, ...bar });
      return;
    }
    const generation = ++this.generation;
    const context = await this.deps.context(appName);
    if (generation !== this.generation) return;
    this.set({ popover, appName, context, ...(output === undefined ? {} : { output }) });
    this.surface = this.open(generation, output);
  }

  /**
   * Moves the open popover to another screen: its surface closes and a new
   * one opens there. What the menus read about the desktop stays as it was
   * when the popover first opened; the old surface still holds the keyboard,
   * so reading it again would find no window focused.
   */
  protected relocate(popover: Popover, output: string | undefined): void {
    const { appName, context } = this.state;
    const generation = ++this.generation;
    const old = this.surface;
    this.surface = null;
    this.set({ popover, appName, context, ...(output === undefined ? {} : { output }) });
    // The old surface's `onClosed` is stale by now and does nothing.
    old?.close();
    this.surface = this.open(generation, output);
  }

  protected open(generation: number, output: string | undefined): OverlayHandle {
    return this.deps.openSurface(() => {
      // The surface went by itself (its host died): forget it, do not close it again.
      if (generation !== this.generation) return;
      this.surface = null;
      this.set(CLOSED);
    }, output);
  }

  /** Whether the popover is, or would open, on this screen. */
  protected isOn(output: string | undefined): boolean {
    return this.state.output === output;
  }

  protected set(state: MenuState): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}
