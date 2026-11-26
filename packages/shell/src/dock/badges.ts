/**
 * What apps say about themselves on their Dock icon (DK-3, decisions.md
 * D801): a count (unread mail, messages) and a progress (a download, a copy),
 * through the launcher API Linux apps already speak: the
 * `com.canonical.Unity.LauncherEntry` `Update` signal on the session bus,
 * `(s app_uri, a{sv} properties)`, the URI `application://<id>.desktop`,
 * the properties `count` (x), `count-visible` (b), `progress` (d, 0–1),
 * `progress-visible` (b). Chromium (Helium), Firefox, Thunderbird and
 * Telegram send it. Each app's latest word stands until it says otherwise or
 * leaves the bus (its unique name losing its owner), which clears it.
 *
 * The Dock draws a count as an ink pill and progress as an ink bar on a
 * paper plate, never red, never the accent (lib/icon.tsx).
 */

import { useSyncExternalStore } from "react";
import type { Message } from "../shared/dbus/index.ts";
import { unwrap } from "../shared/dbus/index.ts";

export const LAUNCHER_ENTRY = "com.canonical.Unity.LauncherEntry";

/** One app's word: its count (shown only when positive) and its progress (0–1), each absent when hidden. */
export interface Badge {
  count?: number;
  progress?: number;
}

/** What the Update signal's properties say, merged into what the app said before (each key only when sent). */
export function readUpdate(before: Badge, properties: unknown): Badge {
  if (!(properties instanceof Map)) return before;
  const value = (key: string): unknown => (properties.has(key) ? unwrap(properties.get(key)) : undefined);
  const next: Badge = { ...before };
  const count = value("count");
  const countVisible = value("count-visible");
  const progress = value("progress");
  const progressVisible = value("progress-visible");
  if (typeof count === "number" || typeof count === "bigint") next.count = Math.max(0, Number(count));
  if (countVisible === false) delete next.count;
  if (typeof progress === "number" && Number.isFinite(progress)) next.progress = Math.min(1, Math.max(0, progress));
  if (progressVisible === false) delete next.progress;
  // Visible with nothing said yet: nothing to draw.
  if (countVisible === true && next.count === undefined) delete next.count;
  if (progressVisible === true && next.progress === undefined) delete next.progress;
  return next;
}

/** The app id an `application://` URI names: `application://org.mozilla.firefox.desktop` → `org.mozilla.firefox`. */
export function appIdOfUri(uri: unknown): string | null {
  if (typeof uri !== "string") return null;
  const match = /^application:\/\/(.+?)(?:\.desktop)?$/.exec(uri.trim());
  return match?.[1] ?? null;
}

/** Whether a badge has anything to draw: a positive count or a progress. */
export const showsBadge = (badge: Badge | undefined): boolean => badge !== undefined && ((badge.count ?? 0) > 0 || badge.progress !== undefined);

type BadgeMap = ReadonlyMap<string, Badge>;

/** The session bus, as much of it as the store uses. */
export interface BadgeBus {
  subscribe(rule: { type: "signal"; interface: string; member: string }, handler: (message: Message) => void): Promise<() => Promise<void>>;
}

export class DockBadges {
  private badges: BadgeMap = new Map();
  /** Which bus name last spoke for each app, so its leaving clears it. */
  private readonly senders = new Map<string, string>();
  private readonly listeners = new Set<() => void>();
  private stops: Array<() => Promise<void>> = [];

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): BadgeMap => this.badges;

  /** Listen on `bus` for apps' updates and for their leaving. */
  async listen(bus: BadgeBus): Promise<void> {
    this.stops.push(await bus.subscribe({ type: "signal", interface: LAUNCHER_ENTRY, member: "Update" }, (message) => this.update(message)));
    this.stops.push(
      await bus.subscribe({ type: "signal", interface: "org.freedesktop.DBus", member: "NameOwnerChanged" }, (message) => {
        const [name, , owner] = message.body;
        if (typeof name === "string" && owner === "") this.gone(name);
      }),
    );
  }

  /** An app's Update signal. */
  update(message: Pick<Message, "body" | "sender">): void {
    const [uri, properties] = message.body;
    const app = appIdOfUri(uri);
    if (!app) return;
    if (message.sender) this.senders.set(app, message.sender);
    const next = readUpdate(this.badges.get(app) ?? {}, properties);
    this.set(app, showsBadge(next) ? next : null);
  }

  /** A bus name left: what it said goes with it. */
  gone(sender: string): void {
    for (const [app, from] of this.senders) {
      if (from !== sender) continue;
      this.senders.delete(app);
      this.set(app, null);
    }
  }

  close(): void {
    for (const stop of this.stops) void stop().catch(() => {});
    this.stops = [];
    this.listeners.clear();
  }

  private set(app: string, badge: Badge | null): void {
    const had = this.badges.get(app);
    if (!badge && !had) return;
    const next = new Map(this.badges);
    if (badge) next.set(app, badge);
    else next.delete(app);
    this.badges = next;
    for (const listener of this.listeners) listener();
  }
}

const NONE: BadgeMap = new Map();
const nobody = (): (() => void) => () => {};

/** The badges by app id; none without a store. */
export function useBadges(store: DockBadges | null): BadgeMap {
  return useSyncExternalStore(store?.subscribe ?? nobody, store?.getSnapshot ?? (() => NONE));
}

/** The badge for a Dock entry: its key, or the app id it was started under. */
export function badgeFor(badges: BadgeMap, ...ids: readonly string[]): Badge | undefined {
  for (const id of ids) {
    const found = badges.get(id) ?? badges.get(id.toLowerCase());
    if (found) return found;
  }
  return undefined;
}
