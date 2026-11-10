/**
 * The menus apps published, by process, and the ones the menu bar shows now:
 * those of the focused window's process. A Metal app's window belongs to its
 * host, a child of the app's Bun process, so a window is matched by its own
 * pid and then its parent's (`focus.ts` says which those are), never further
 * up: a session or a terminal that started the app does not get to dress its
 * windows.
 *
 * While a popover is open (`hold`), the keyboard is on the popover and no
 * window is focused; the bar keeps showing the menus it had, as it keeps the
 * app's name (menus/popover.tsx). An app can still change its rows then.
 */

import { useSyncExternalStore } from "react";
import { type AppMenu, enabledItem, isOpenArgs, type PublishedMenus, type ShellMessage } from "../shared/app-menus/protocol.ts";
import { isTextShortcut, itemForShortcut } from "./shortcut.ts";

/** One app's end of the channel. */
export interface MenuOwner {
  readonly pid: number;
  send(message: ShellMessage): void;
}

export class AppMenuStore {
  private readonly byPid = new Map<number, { owner: MenuOwner; published: PublishedMenus }>();
  /** The focused window's pid, then its parent's. */
  private focus: readonly number[] = [];
  private held = false;
  private active: PublishedMenus | null = null;
  private readonly listeners = new Set<() => void>();
  /** Told when an app asks for its window to be brought forward (protocol.ts `front`). */
  private readonly frontListeners = new Set<(pid: number) => void>();
  /** Told of every publish and withdrawal, whoever is focused (the action registry's menus: actions/sources/menus.ts). */
  private readonly publishedListeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** The focused app's menus, null when it published none. */
  getSnapshot = (): PublishedMenus | null => this.active;

  /** `owner` asks for its window to be brought forward (protocol.ts `front`). */
  front(owner: MenuOwner): void {
    for (const listener of this.frontListeners) listener(owner.pid);
  }

  /** Hear the apps that ask to be brought forward, by process; returns the way to stop. */
  onFront(listener: (pid: number) => void): () => void {
    this.frontListeners.add(listener);
    return () => this.frontListeners.delete(listener);
  }

  /** `owner`'s menus now (an empty list takes them down); a newer connection of the same process replaces an older one. */
  publish(owner: MenuOwner, menus: readonly AppMenu[], typing = false): void {
    if (menus.length === 0) this.byPid.delete(owner.pid);
    else this.byPid.set(owner.pid, { owner, published: { pid: owner.pid, menus, ...(typing ? { typing: true } : {}) } });
    this.update();
    for (const listener of this.publishedListeners) listener();
  }

  /** `owner`'s connection closed: its menus go, unless a newer connection of that process holds them. */
  withdraw(owner: MenuOwner): void {
    if (this.byPid.get(owner.pid)?.owner !== owner) return;
    this.byPid.delete(owner.pid);
    this.update();
    for (const listener of this.publishedListeners) listener();
  }

  /** Every process's menus, focused or not. */
  published(): PublishedMenus[] {
    return [...this.byPid.values()].map(({ published }) => published);
  }

  /** Hear every publish and withdrawal; returns what stops listening. */
  onPublished(listener: () => void): () => void {
    this.publishedListeners.add(listener);
    return () => this.publishedListeners.delete(listener);
  }

  /** The focused window's process and its parent (empty: nothing focused). Ignored while held. */
  setFocus(pids: readonly number[]): void {
    if (this.held) return;
    this.focus = [...pids];
    this.update();
  }

  /** A popover opened (true) or closed: the bar keeps the menus it had meanwhile. */
  hold(on: boolean): void {
    this.held = on;
  }

  /** The menus for a window of these processes (its pid, then its parent's), focused or not. */
  menusFor(pids: readonly number[]): PublishedMenus | null {
    for (const pid of pids) {
      const found = this.byPid.get(pid);
      if (found) return found.published;
    }
    return null;
  }

  /** Tells `pid` its item was chosen; false when it has no such item to choose (gone, changed, or disabled). */
  select(pid: number, itemId: string): boolean {
    const found = this.byPid.get(pid);
    if (!found || !enabledItem(found.published.menus, itemId)) return false;
    found.owner.send({ type: "select", id: itemId });
    return true;
  }

  /**
   * Chooses the enabled item showing `shortcut` in the menus of these
   * processes; false when none shows it, or when it is a text chord and a
   * field has the keyboard (the field answers it: shortcut.ts `TEXT_SHORTCUTS`).
   */
  shortcut(pids: readonly number[], shortcut: string): boolean {
    const published = this.menusFor(pids);
    if (published?.typing && isTextShortcut(shortcut)) return false;
    const item = published && itemForShortcut(published.menus, shortcut);
    return Boolean(published && item && this.select(published.pid, item));
  }

  /** Hands these processes' app the arguments a second start would have had (protocol.ts `open`); false when it has no menus channel or they don't fit. */
  open(pids: readonly number[], args: readonly string[]): boolean {
    const pid = pids.find((each) => this.byPid.has(each));
    if (pid === undefined || !isOpenArgs(args)) return false;
    this.byPid.get(pid)?.owner.send({ type: "open", args: [...args] });
    return true;
  }

  /** Tells these processes' app that it is quitting, just before its windows are asked to close (kit/close.ts); false when it has no menus channel. */
  quitting(pids: readonly number[]): boolean {
    const pid = pids.find((each) => this.byPid.has(each));
    if (pid === undefined) return false;
    this.byPid.get(pid)?.owner.send({ type: "quit" });
    return true;
  }

  /** Tells these processes' app its quit is called off (a log out was cancelled): what it asked goes (kit/close.ts); false when it has no menus channel. */
  stay(pids: readonly number[]): boolean {
    const pid = pids.find((each) => this.byPid.has(each));
    if (pid === undefined) return false;
    this.byPid.get(pid)?.owner.send({ type: "stay" });
    return true;
  }

  private update(): void {
    // The held menus follow their app's updates, and go if it does.
    const next = this.held ? this.active && (this.byPid.get(this.active.pid)?.published ?? null) : this.menusFor(this.focus);
    if (next === this.active) return;
    this.active = next;
    for (const listener of this.listeners) listener();
  }
}

export function useAppMenus(store: AppMenuStore): PublishedMenus | null {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
