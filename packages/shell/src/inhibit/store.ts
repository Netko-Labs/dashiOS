/**
 * What apps are keeping the computer awake. A video player asks through the
 * portal's Inhibit (which dashi-portal hands to the shell, portal-host/) or
 * straight through org.freedesktop.ScreenSaver (screensaver.ts); each ask is
 * a hold here, kept until its owner lets go or leaves the bus. The idle
 * policy (idle.ts) reads `blocks` before it blanks the screens or sleeps, and
 * the battery menu shows what is holding (menu.ts), with "Allow Sleep" to
 * ignore the holds there are now.
 */

import { useSyncExternalStore } from "react";

/** What a hold keeps from happening, as the portal's Inhibit flags are. */
export const InhibitFlag = {
  logout: 1,
  userSwitch: 2,
  /** The computer going to sleep by itself. */
  suspend: 4,
  /** The screens blanking (and, after them, sleep) while nobody touches anything. */
  idle: 8,
} as const;

const ALL_FLAGS = 15;
/** One program asking more than this many times is a bug, not more reasons to stay awake. */
const MAX_PER_OWNER = 32;
const MAX_TEXT = 200;

export interface Hold {
  id: number;
  /** The bus name that asked (a unique name): its holds go when it leaves the bus. */
  owner: string;
  /** The app's id (a desktop id or its name, whatever it gave), for its name and icon. */
  appId: string;
  /** Why, in the app's words. */
  reason: string;
  flags: number;
  /** When it was taken (ms since the epoch). */
  since: number;
  /** The person chose "Allow Sleep" while it was held: it no longer counts. */
  ignored: boolean;
  via: "portal" | "screensaver";
}

export interface HoldRequest {
  owner: string;
  appId: string;
  reason: string;
  flags: number;
  via: Hold["via"];
}

/** Text from an app, made safe to keep and show: no control characters, not too long. */
export const cleanText = (text: string): string =>
  text
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .trim()
    .slice(0, MAX_TEXT);

export class InhibitStore {
  private holds: readonly Hold[] = [];
  private next = 1;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly now: () => number = Date.now) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): readonly Hold[] => this.holds;

  /** Takes a hold and returns its id (never 0, which ScreenSaver callers read as a failure); null when the owner has too many. */
  add(request: HoldRequest): number | null {
    if (this.holds.filter((hold) => hold.owner === request.owner).length >= MAX_PER_OWNER) return null;
    const id = this.next;
    this.next = this.next >= 0xffffffff ? 1 : this.next + 1;
    const hold: Hold = {
      id,
      owner: request.owner,
      appId: cleanText(request.appId),
      reason: cleanText(request.reason),
      flags: request.flags & ALL_FLAGS,
      since: this.now(),
      ignored: false,
      via: request.via,
    };
    this.set([...this.holds, hold]);
    return id;
  }

  /** Lets go of a hold; only its owner may. Whether there was one. */
  release(id: number, owner: string): boolean {
    const next = this.holds.filter((hold) => !(hold.id === id && hold.owner === owner));
    if (next.length === this.holds.length) return false;
    this.set(next);
    return true;
  }

  /** Everything `owner` held (it left the bus, or died). How many went. */
  releaseOwner(owner: string): number {
    const next = this.holds.filter((hold) => hold.owner !== owner);
    const gone = this.holds.length - next.length;
    if (gone > 0) this.set(next);
    return gone;
  }

  /** "Allow Sleep": the holds there are now stop counting, until their apps let go. */
  ignoreAll(): void {
    if (!this.holds.some((hold) => !hold.ignored)) return;
    this.set(this.holds.map((hold) => (hold.ignored ? hold : { ...hold, ignored: true })));
  }

  /** Whether any hold that counts keeps `flag` from happening. */
  blocks(flag: number): boolean {
    return this.holds.some((hold) => !hold.ignored && (hold.flags & flag) !== 0);
  }

  /** The holds that keep the screen or the computer awake, oldest first: what the battery menu lists. */
  awake(): Hold[] {
    return this.holds.filter((hold) => !hold.ignored && (hold.flags & (InhibitFlag.idle | InhibitFlag.suspend)) !== 0);
  }

  private set(next: readonly Hold[]): void {
    this.holds = next;
    for (const listener of this.listeners) listener();
  }
}

let shared: InhibitStore | null = null;

/** The desktop's one store: the portal host and ScreenSaver add to it, idle and the battery menu read it. */
export function keepAwake(): InhibitStore {
  return (shared ??= new InhibitStore());
}

export function useHolds(store: InhibitStore): readonly Hold[] {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
