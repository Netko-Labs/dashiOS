/**
 * Every notification the desktop knows: which are live, which of those the
 * banner stack shows, and the history the notification center lists. Apps
 * reach it through the D-Bus server (server.ts); the banners and the center
 * read it through `useNotifications`.
 *
 * Lifecycle, as the spec has it: a notification stays until it expires, the
 * person dismisses it, or its app closes it; every ending is reported with a
 * reason (`closed` events), and invoking an action is reported too. Critical
 * notifications never expire by themselves. Banners expire in order of
 * arrival and at most `MAX_BANNERS` show at once; the rest wait their turn,
 * their timers not started until they show.
 *
 * Do-not-disturb hides non-critical banners but changes nothing else: they
 * stay in the history, count down, and close like any other.
 *
 * The history is the center's contents: closing a notification (expiry
 * included) keeps it there, marked closed, until the person removes it, the
 * history is full (`MAX_HISTORY`, the oldest closed one goes first), or it is
 * cleared. It lives in memory only: ids restart with the shell, so a restored
 * entry could collide with a new notification and no restored action could
 * reach an app that has since reconnected under another name.
 *
 * While the center is open nothing shows as a banner: what is live is in the
 * center, and having been seen there it does not come back as a banner when
 * the center closes.
 */

import { useSyncExternalStore } from "react";
import { markClosed, recordInHistory } from "./lib/history.ts";
import { freeId, type Live } from "./lib/live.ts";
import { displayTime, HOVER_GRACE_MS, type Scheduler, timeoutScheduler } from "./lib/timing.ts";
import { CloseReason, type HistoryEntry, type Notification, type NotifyInput, type StoreEvent, type StoreSnapshot } from "./types.ts";

export const MAX_BANNERS = 3;
/** The `sender` of a notification the shell posts itself (no app on the bus to ask): a click in the center always runs its action. */
export const SHELL_SENDER = "dashi:shell";
const MAX_LIVE = 64;

export interface StoreOptions {
  schedule?: Scheduler;
  now?: () => number;
}

/** Whether the app behind a notification (its bus name) is still connected. */
export type Presence = (sender: string) => Promise<boolean>;

export class NotificationStore {
  private readonly live = new Map<number, Live>();
  private history: HistoryEntry[] = [];
  private dnd = false;
  private centerOpen = false;
  private presence: Presence = () => Promise.resolve(true);
  private nextId = 1;
  private snapshot: StoreSnapshot = { live: [], banners: [], history: [], doNotDisturb: false };
  private readonly listeners = new Set<() => void>();
  private readonly eventListeners = new Set<(event: StoreEvent) => void>();
  private readonly schedule: Scheduler;
  private readonly now: () => number;

  constructor({ schedule = timeoutScheduler, now = Date.now }: StoreOptions = {}) {
    this.schedule = schedule;
    this.now = now;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): StoreSnapshot => this.snapshot;

  /** Hear notifications close and actions get invoked. */
  onEvent(listener: (event: StoreEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  /**
   * Show a notification, or replace the one `replacesId` names (it keeps its
   * place and id). `sender` is the caller's bus name, kept so a click in the
   * center can tell whether the app is still there. Returns the id.
   */
  notify(input: NotifyInput, replacesId = 0, sender = ""): number {
    const existing = replacesId > 0 ? this.live.get(replacesId) : undefined;
    const id = replacesId > 0 ? replacesId : this.takeId();
    if (id >= this.nextId) this.nextId = id + 1;
    const notification: Notification = {
      ...input,
      id,
      sender,
      time: this.now(),
      revision: existing ? existing.notification.revision + 1 : 0,
    };
    existing?.cancel?.();
    this.live.set(id, { notification, cancel: null, held: false, seen: this.centerOpen });
    this.history = recordInHistory(this.history, notification);
    this.trim();
    this.settle();
    return id;
  }

  /** Close a live notification; false if there was none (nothing is reported then). */
  close(id: number, reason: CloseReason): boolean {
    if (!this.end(id, reason)) return false;
    this.settle();
    return true;
  }

  dismiss(id: number): boolean {
    return this.close(id, CloseReason.dismissed);
  }

  /**
   * The person chose an action (a click is `default`). Reports it, then
   * closes the notification unless the app marked it resident. False if the
   * notification is gone or has no such action.
   */
  invoke(id: number, key: string): boolean {
    const entry = this.live.get(id);
    if (!entry?.notification.actions.some((action) => action.key === key)) return false;
    this.emit({ type: "action", id, key });
    if (!entry.notification.resident) this.close(id, CloseReason.dismissed);
    return true;
  }

  /** The pointer entered (`true`) or left a banner: hold its countdown, or give it a short one. */
  hold(id: number, held: boolean): void {
    const entry = this.live.get(id);
    if (!entry) return;
    entry.held = held;
    entry.cancel?.();
    entry.cancel = null;
    if (!held && this.isCounting(entry, new Set(this.banners().map(({ id: shown }) => shown)))) {
      this.countdown(entry, HOVER_GRACE_MS);
    }
  }

  get doNotDisturb(): boolean {
    return this.dnd;
  }

  setDoNotDisturb(on: boolean): void {
    if (on === this.dnd) return;
    this.dnd = on;
    this.settle();
  }

  /** The center opened or closed: banners go away while it is open, and stay gone after. */
  setCenterOpen(open: boolean): void {
    if (open === this.centerOpen) return;
    this.centerOpen = open;
    if (open) {
      for (const entry of this.live.values()) {
        entry.seen = true;
        // Its banner is gone, so no pointer will ever leave it: let it count down.
        entry.held = false;
      }
    }
    this.settle();
  }

  /** How a click in the center finds out whether an app is still connected (the D-Bus server sets it). */
  setPresence(check: Presence | null): void {
    this.presence = check ?? (() => Promise.resolve(true));
  }

  /**
   * Take notifications out of the center: the ids given, or all of them. A
   * live one is dismissed first, so its app hears `NotificationClosed`.
   * Returns how many went.
   */
  remove(ids?: readonly number[]): number {
    const gone = new Set(ids ?? this.history.map((entry) => entry.id));
    const before = this.history.length;
    let ended = false;
    for (const id of gone) ended = this.end(id, CloseReason.dismissed) || ended;
    this.history = this.history.filter((entry) => !gone.has(entry.id));
    // A live one that ended changed the banners even if it was never in the history (a transient one).
    if (ended || this.history.length !== before) this.settle();
    return before - this.history.length;
  }

  /**
   * The person clicked a notification in the center: tell its app about the
   * `default` action, then take it out of the center unless the app marked it
   * resident. False, and nothing reported, if it has no `default` action or its
   * app has left the bus (the caller then just removes it).
   *
   * An app that has already been told the notification closed may no longer
   * know its id, and then ignores the action; that is the app's call.
   */
  async activate(id: number): Promise<boolean> {
    const found = this.history.find((entry) => entry.id === id);
    if (!found?.actions.some((action) => action.key === "default")) return false;
    const present = found.sender === SHELL_SENDER || (await this.presence(found.sender).catch(() => false));
    // It may have been removed, or replaced by a notification without the action, while we asked.
    const entry = this.history.find((candidate) => candidate.id === id);
    if (!present || !entry?.actions.some((action) => action.key === "default")) return false;
    this.emit({ type: "action", id, key: "default" });
    if (!entry.resident) this.remove([id]);
    return true;
  }

  // Internals.

  /** Close a live notification and report it, leaving the publishing to the caller. */
  private end(id: number, reason: CloseReason): boolean {
    const entry = this.live.get(id);
    if (!entry) return false;
    entry.cancel?.();
    this.live.delete(id);
    this.history = markClosed(this.history, id, { reason, time: this.now() });
    this.emit({ type: "closed", id, reason });
    return true;
  }

  private takeId(): number {
    this.nextId = freeId(this.nextId, this.live);
    return this.nextId;
  }

  /**
   * Past the live cap, the oldest non-critical ones are closed as `undefined`;
   * if they are not enough, the oldest critical ones go too, or an app
   * sending critical notifications without end would grow the list without bound.
   */
  private trim(): void {
    if (this.live.size <= MAX_LIVE) return;
    const oldestFirst = [...this.live.values()].map(({ notification }) => notification);
    const order = [...oldestFirst.filter(({ urgency }) => urgency !== "critical"), ...oldestFirst.filter(({ urgency }) => urgency === "critical")];
    for (const notification of order) {
      if (this.live.size <= MAX_LIVE) return;
      this.close(notification.id, CloseReason.undefined);
    }
  }

  /** Whether a banner may show it: not once seen in the center, and not under DND unless critical. */
  private shown({ notification, seen }: Live): boolean {
    return !seen && (!this.dnd || notification.urgency === "critical");
  }

  /** A banner that shows, or that DND hides: either way its time is running. */
  private isCounting(entry: Live, banners: ReadonlySet<number>): boolean {
    return !entry.held && displayTime(entry.notification) !== null && (!this.shown(entry) || banners.has(entry.notification.id));
  }

  private banners(): Notification[] {
    return [...this.live.values()]
      .filter((entry) => this.shown(entry))
      .map((entry) => entry.notification)
      .slice(0, MAX_BANNERS);
  }

  private countdown(entry: Live, ms: number): void {
    const id = entry.notification.id;
    entry.cancel = this.schedule(() => {
      entry.cancel = null;
      this.close(id, CloseReason.expired);
    }, ms);
  }

  /** Start the countdown of whatever just became visible, then publish. */
  private settle(): void {
    const banners = this.banners();
    const showing = new Set(banners.map(({ id }) => id));
    for (const entry of this.live.values()) {
      const time = displayTime(entry.notification);
      if (time !== null && !entry.cancel && this.isCounting(entry, showing)) this.countdown(entry, time);
    }
    const live = [...this.live.values()].map((entry) => entry.notification);
    this.snapshot = { live, banners, history: [...this.history], doNotDisturb: this.dnd };
    for (const listener of [...this.listeners]) listener();
  }

  private emit(event: StoreEvent): void {
    for (const listener of [...this.eventListeners]) {
      try {
        listener(event);
      } catch (error) {
        console.error("dashi-shell: a notification listener threw:", error);
      }
    }
  }
}

export function useNotifications(store: NotificationStore): StoreSnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
