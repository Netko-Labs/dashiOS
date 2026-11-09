/**
 * The one popover the menu bar can have open: a dropdown menu, Control
 * Center, the notification center, or a Dock icon's menu. All live on a single overlay surface,
 * so moving from one menu to the next only swaps what that surface shows;
 * the surface itself opens on the first and closes with the last.
 *
 * The surface takes the keyboard (that is how Esc and the arrows reach it),
 * and the compositor then shows every window as inactive. So what the menus
 * need to know about the desktop is read just before the surface opens and
 * kept until it closes, and the menu bar keeps showing that app's name.
 *
 * With several screens each has a menu bar, and the popover opens on the
 * screen of the bar that was clicked (`output`, the screen's name). Clicking
 * or hovering a bar on another screen while a popover is open moves it there.
 */

import { useSyncExternalStore } from "react";
import type { ControlPage } from "../control-center/index.ts";
import type { DockMenuAction } from "../dock/menu.ts";
import type { OverlayHandle } from "../overlay.tsx";
import { type BarStop, barCommand, sideStep, stepStop, stopOfPopover, titleStop } from "./bar-keys.ts";
import type { BarMenuId, MenuContext, MenuEntry } from "./model.ts";
import type { StatusMenuAction } from "./status-menu.ts";

export type Popover =
  | { kind: "menu"; id: BarMenuId; x: number }
  /** An app's menu in the Dock: its rows were built when it opened; `x` is the icon's center. */
  | { kind: "dock-menu"; x: number; entries: readonly MenuEntry<DockMenuAction>[]; above?: number }
  | { kind: "control-center"; page: ControlPage }
  /** The battery panel (battery/panel.tsx), its right edge at `right` (screen pixels), or where Control Center is when null. */
  | { kind: "battery"; right: number | null }
  | { kind: "notification-center" }
  /** The agents' panel under their mark (agents-panel.tsx), its right edge at `right`; `focus` is the run it opened on. */
  | { kind: "agents"; right: number; focus: string | null }
  /** A status item's menu (an extra's or the battery's), its right edge at `right` (screen pixels); `key` says whose. */
  | { kind: "status-menu"; key: string; right: number; entries: readonly MenuEntry<StatusMenuAction>[] }
  /** "…": the status items that didn't fit, in a row under it (bar-overflow.tsx), its right edge at `right`. */
  | { kind: "overflow"; right: number; keys: readonly string[] };

export interface MenuState {
  popover: Popover | null;
  /** The app name the bar showed when the popover opened; null while closed. */
  appName: string | null;
  context: MenuContext | null;
  /** The screen the popover is on (an output name); absent when the bar did not say, which is the compositor's choice. */
  output?: string;
  /**
   * The keyboard is in that screen's bar (bar-keys.ts, ⌃F2): the stop the
   * ring is on, while the popover surface holds the keys, with or without a
   * popover open. Absent otherwise.
   */
  bar?: string;
}

/** What a bar tells the controller about itself (menubar.tsx): its stops in order, and the app name it shows. */
export interface BarInfo {
  appName: string;
  stops: readonly BarStop[];
}

const CLOSED: MenuState = { popover: null, appName: null, context: null };

export interface ControllerDeps {
  /** Reads the desktop for the menus (before the surface takes the keyboard). */
  context(appName: string): Promise<MenuContext>;
  /** Opens the popover surface on that screen; `onClosed` runs when it goes, however it went. */
  openSurface(onClosed: () => void, output?: string): OverlayHandle;
}

export class MenuController {
  private state: MenuState = CLOSED;
  private surface: OverlayHandle | null = null;
  /** Bumped by every open and close, so a slow `context` cannot reopen what was closed. */
  private generation = 0;
  private readonly listeners = new Set<() => void>();
  /** Each bar's stops and name, by its screen ("" for a bar placed by the compositor). */
  private readonly bars = new Map<string, BarInfo & { output: string | undefined }>();
  /** The stop being opened from the keyboard, so what opens keeps the ring on it. */
  private opening: string | null = null;

  constructor(private readonly deps: ControllerDeps) {}

  /** A bar says what its stops are now (every time it draws). */
  setBar(output: string | undefined, info: BarInfo): void {
    this.bars.set(output ?? "", { ...info, output });
  }

  /** A bar went (its screen left). */
  dropBar(output: string | undefined): void {
    this.bars.delete(output ?? "");
  }

  /**
   * ⌃F2: the keyboard goes to the bar on `output` (the first bar when that
   * screen has none, or none was named), its ring on the Dashi menu; with a
   * menu open from a click, on that menu. Again while it is there: it
   * leaves, and the window that had the keyboard has it back.
   */
  async focusBar(output?: string): Promise<void> {
    if (this.state.bar !== undefined) return this.close();
    if (this.surface) {
      const stops = this.stopsHere();
      const key = stopOfPopover(this.state.popover) ?? stops[0]?.key;
      if (key !== undefined) this.set({ ...this.state, bar: key });
      return;
    }
    const bar = this.bars.get(output ?? "") ?? this.bars.values().next().value;
    const first = bar?.stops[0]?.key;
    if (!bar || first === undefined) return;
    const generation = ++this.generation;
    const context = await this.deps.context(bar.appName);
    if (generation !== this.generation) return;
    this.set({ popover: null, appName: bar.appName, context, ...(bar.output === undefined ? {} : { output: bar.output }), bar: first });
    this.surface = this.open(generation, bar.output);
  }

  /** A key while the ring is in the bar and nothing is open (popover.tsx): move, open, or leave. */
  barKey(key: string): void {
    const bar = this.state.bar;
    const command = barCommand(key);
    if (bar === undefined || command === null) return;
    if (command.kind === "leave") return this.close();
    const stops = this.stopsHere();
    if (command.kind === "move") {
      const next = stepStop(
        stops.map((stop) => stop.key),
        bar,
        command.toward,
      );
      if (next !== null && next !== bar) this.set({ ...this.state, bar: next });
      return;
    }
    const stop = stops.find((each) => each.key === bar);
    if (stop) this.openStop(stop);
  }

  /**
   * ← or → in a menu that dropped from the bar (clicked or from the keys):
   * the next title's menu opens in its place; past the titles the menu
   * closes and the ring stands on the status item.
   */
  side(toward: "left" | "right"): void {
    const stops = this.stopsHere();
    const step = sideStep(stops, this.state.bar ?? stopOfPopover(this.state.popover), toward);
    if (!step) return;
    this.set({ ...this.state, popover: null, bar: step.key });
    const stop = stops.find((each) => each.key === step.key);
    if (step.opens && stop) this.openStop(stop);
  }

  /**
   * Esc in what is open: back to the bar when the keyboard came from it, so
   * a second Esc leaves; closed otherwise.
   */
  back(): void {
    if (this.state.bar !== undefined && this.surface) this.set({ ...this.state, popover: null });
    else this.close();
  }

  private openStop(stop: BarStop): void {
    // An item that only acts (an app's item, the recording's stop) leaves the bar first, so its window gets the keyboard.
    if (stop.kind === "action") {
      this.close();
      stop.open();
      return;
    }
    this.opening = stop.key;
    try {
      stop.open();
    } finally {
      this.opening = null;
    }
  }

  /** What a screen reader says for a stop of the bar the popover is on. */
  labelOf(key: string): string | null {
    return this.stopsHere().find((stop) => stop.key === key)?.label ?? null;
  }

  /** The stops of the bar the popover is on. */
  private stopsHere(): readonly BarStop[] {
    return (this.bars.get(this.state.output ?? "") ?? this.bars.values().next().value)?.stops ?? [];
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): MenuState => this.state;

  /** A click on a title: opens its menu, or closes it if it is the open one. */
  toggleMenu(id: BarMenuId, x: number, appName: string, output?: string): Promise<void> {
    const open = this.state.popover;
    if (open?.kind === "menu" && open.id === id && this.isOn(output)) {
      this.close();
      return Promise.resolve();
    }
    return this.show({ kind: "menu", id, x }, appName, output);
  }

  /** The pointer reached a title: if a menu is open, it switches to this one (on this title's screen). */
  hoverMenu(id: BarMenuId, x: number, output?: string): void {
    const open = this.state.popover;
    if (open?.kind !== "menu") return;
    if (!this.isOn(output)) this.relocate({ kind: "menu", id, x }, output);
    else if (open.id !== id) this.set({ ...this.state, popover: { kind: "menu", id, x }, ...(this.state.bar === undefined ? {} : { bar: titleStop(id) }) });
  }

  /**
   * A right-click or long press on a Dock icon, or on the Dock itself. The menu ends `above` px over the
   * screen's bottom edge (popover.tsx's default clears the floating Dock).
   */
  openDockMenu(x: number, entries: readonly MenuEntry<DockMenuAction>[], appName: string, output?: string, above?: number): Promise<void> {
    return this.show({ kind: "dock-menu", x, entries, ...(above === undefined ? {} : { above }) }, appName, output);
  }

  /**
   * A click on the status icons (the main page) or on the network glyph (the
   * Wi-Fi page): opens Control Center there, or closes it. Asking for the
   * Wi-Fi page while it shows the main one turns the page instead.
   */
  toggleControlCenter(appName: string, page: ControlPage = "main", output?: string): Promise<void> {
    const open = this.state.popover;
    if (open?.kind === "control-center" && this.isOn(output)) {
      if (page === "wifi" && open.page !== "wifi") this.setControlPage(page);
      else this.close();
      return Promise.resolve();
    }
    return this.show({ kind: "control-center", page }, appName, output);
  }

  /** Turns Control Center's page; nothing happens if it is not open. */
  setControlPage(page: ControlPage): void {
    const open = this.state.popover;
    if (open?.kind === "control-center" && open.page !== page) this.set({ ...this.state, popover: { kind: "control-center", page } });
  }

  /**
   * A click on a status item with a menu: opens it below the item (its right
   * edge at `right`), or closes it if it is the one open. `key` names the
   * item ("battery", or an extra's key).
   */
  toggleStatusMenu(key: string, right: number, entries: readonly MenuEntry<StatusMenuAction>[], appName: string, output?: string): Promise<void> {
    const open = this.state.popover;
    if (open?.kind === "status-menu" && open.key === key && this.isOn(output)) {
      this.close();
      return Promise.resolve();
    }
    return this.show({ kind: "status-menu", key, right, entries }, appName, output);
  }

  /** A click on the battery item: its panel under it, or closed if it is open. */
  toggleBattery(right: number, appName: string, output?: string): Promise<void> {
    if (this.state.popover?.kind === "battery" && this.isOn(output)) {
      this.close();
      return Promise.resolve();
    }
    return this.show({ kind: "battery", right }, appName, output);
  }

  /** Control Center's battery row: the battery panel takes Control Center's place. */
  showBatteryFromControlCenter(): void {
    if (this.state.popover?.kind === "control-center") this.set({ ...this.state, popover: { kind: "battery", right: null } });
  }

  /** A click on the agent mark: the agents' panel, or closed if it is open; `focus` a run's card (a notification's Show). */
  toggleAgents(appName: string, right: number, focus: string | null = null, output?: string): Promise<void> {
    if (this.state.popover?.kind === "agents" && this.isOn(output) && focus === null) {
      this.close();
      return Promise.resolve();
    }
    return this.show({ kind: "agents", right, focus }, appName, output);
  }

  /** A click on "…": the hidden status items, or closed if they are showing. */
  toggleOverflow(appName: string, right: number, keys: readonly string[], output?: string): Promise<void> {
    if (this.state.popover?.kind === "overflow" && this.isOn(output)) {
      this.close();
      return Promise.resolve();
    }
    return this.show({ kind: "overflow", right, keys }, appName, output);
  }

  /** The bar's hidden items changed while "…" is open: the row follows (an extra came or went). */
  setOverflow(keys: readonly string[]): void {
    const open = this.state.popover;
    if (open?.kind !== "overflow") return;
    if (keys.length === 0) return this.close();
    if (open.keys.join("\n") !== keys.join("\n")) this.set({ ...this.state, popover: { ...open, keys } });
  }

  /** A click on the clock. */
  toggleNotificationCenter(appName: string, output?: string): Promise<void> {
    if (this.state.popover?.kind === "notification-center" && this.isOn(output)) {
      this.close();
      return Promise.resolve();
    }
    return this.show({ kind: "notification-center" }, appName, output);
  }

  close(): void {
    this.generation++;
    const surface = this.surface;
    this.surface = null;
    this.set(CLOSED);
    surface?.close();
  }

  private async show(popover: Popover, appName: string, output?: string): Promise<void> {
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
  private relocate(popover: Popover, output: string | undefined): void {
    const { appName, context } = this.state;
    const generation = ++this.generation;
    const old = this.surface;
    this.surface = null;
    this.set({ popover, appName, context, ...(output === undefined ? {} : { output }) });
    // The old surface's `onClosed` is stale by now and does nothing.
    old?.close();
    this.surface = this.open(generation, output);
  }

  private open(generation: number, output: string | undefined): OverlayHandle {
    return this.deps.openSurface(() => {
      // The surface went by itself (its host died): forget it, do not close it again.
      if (generation !== this.generation) return;
      this.surface = null;
      this.set(CLOSED);
    }, output);
  }

  /** Whether the popover is, or would open, on this screen. */
  private isOn(output: string | undefined): boolean {
    return this.state.output === output;
  }

  private set(state: MenuState): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}

export function useMenus(controller: MenuController): MenuState {
  return useSyncExternalStore(controller.subscribe, controller.getSnapshot);
}
