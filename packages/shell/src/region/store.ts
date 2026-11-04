/**
 * The system's time zone, clock sync, and language as a store the panes and
 * the Setup Assistant subscribe to, and the agents' tools call. Reads come
 * from timedated and localed (backend.ts) and again when the system says
 * something changed; a write is one at a time, shows `busy` while the
 * password sheet may be up, and ends in `error` when the person said no.
 * The shell's own time zone follows: the process re-reads it on every change.
 */

import { useSyncExternalStore } from "react";
import { type RegionBackend, RegionError, type RegionFailure } from "./backend.ts";
import { isLocaleName, type LocaleEntry, languageOf, localeEntries, withLanguage } from "./locale.ts";
import { buildZones, isTimezoneName, readZoneTables, type Zone, type ZoneTables } from "./timezones.ts";

export type RegionWrite = "timezone" | "ntp" | "language";

export interface RegionState {
  /** Null until the first read; false when the system has no timedated (or no system bus). */
  available: boolean | null;
  timezone: string;
  ntp: boolean;
  canNtp: boolean;
  ntpSynced: boolean;
  /** The system language (`LANG`), when it names a real locale. */
  language: string | null;
  zones: readonly Zone[];
  locales: readonly LocaleEntry[];
  /** The write in flight, if any. */
  busy: RegionWrite | null;
  /** Why the last write did not happen; cleared by the next one. */
  error: RegionFailure | null;
}

export const INITIAL_REGION: RegionState = {
  available: null,
  timezone: "UTC",
  ntp: false,
  canNtp: false,
  ntpSynced: false,
  language: null,
  zones: [],
  locales: [],
  busy: null,
  error: null,
};

export interface RegionStoreOptions {
  /** Tell the process its time zone changed (the clock reads it); `process.env.TZ` unless a test says otherwise. */
  applyTimezone?: (timezone: string) => void;
  /** tzdata's country tables. */
  tables?: () => ZoneTables;
  /** A burst of system changes is one read. */
  debounceMs?: number;
}

const setProcessTimezone = (timezone: string): void => {
  process.env.TZ = timezone;
};

export class RegionStore {
  private snapshot: RegionState = INITIAL_REGION;
  private readonly listeners = new Set<() => void>();
  private reads = 0;
  private stopWatching: (() => void) | null = null;
  private debounce: ReturnType<typeof setTimeout> | undefined;
  private loaded: Promise<void> | null = null;
  /** The system's names for time zones, as listed; `zones` is these made into a list for people. */
  private raw: string[] = [];

  constructor(
    readonly backend: RegionBackend,
    private readonly options: RegionStoreOptions = {},
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): RegionState => this.snapshot;

  /** Read everything and follow the system until `close`. Safe to call again. */
  start(): Promise<void> {
    this.stopWatching ??= this.backend.watch(() => {
      clearTimeout(this.debounce);
      this.debounce = setTimeout(() => void this.refresh(), this.options.debounceMs ?? 200);
    });
    this.loaded ??= this.load();
    return this.loaded;
  }

  close(): void {
    this.stopWatching?.();
    this.stopWatching = null;
    clearTimeout(this.debounce);
    this.backend.close();
  }

  /** The lists (zones, locales) are read once; the values again on every change. */
  private async load(): Promise<void> {
    const [zones, installed] = await Promise.all([
      this.backend.listTimezones().catch(() => [] as string[]),
      this.backend.installedLocales().catch(() => [] as string[]),
    ]);
    this.raw = zones;
    this.publish({ locales: localeEntries(installed) });
    await this.refresh();
  }

  async refresh(): Promise<void> {
    const read = ++this.reads;
    try {
      const [time, locale] = await Promise.all([this.backend.readTime(), this.backend.readLocale().catch(() => [] as string[])]);
      if (read !== this.reads) return;
      (this.options.applyTimezone ?? setProcessTimezone)(time.timezone);
      this.publish({ available: true, ...time, language: languageOf(locale), zones: this.zonesFor(time.timezone) });
    } catch (error) {
      if (read !== this.reads) return;
      this.publish({ available: error instanceof RegionError && error.reason === "unavailable" ? false : this.snapshot.available });
    }
  }

  /** The list for people, rebuilt only when the current zone is not already in it (the offsets are as of the first build). */
  private zonesFor(current: string): readonly Zone[] {
    const known = this.snapshot.zones;
    if (known.length > 0 && known.some((zone) => zone.id === current)) return known;
    return buildZones(this.raw, (this.options.tables ?? readZoneTables)(), new Date(), [current]);
  }

  setTimezone(timezone: string): Promise<RegionFailure | null> {
    if (!isTimezoneName(timezone)) return Promise.resolve("failed");
    if (timezone === this.snapshot.timezone) return Promise.resolve(null);
    return this.write("timezone", () => this.backend.setTimezone(timezone));
  }

  setNtp(on: boolean): Promise<RegionFailure | null> {
    if (on === this.snapshot.ntp) return Promise.resolve(null);
    return this.write("ntp", () => this.backend.setNtp(on));
  }

  /** Sets `LANG` and leaves the other locale variables the system sets as they are. */
  setLanguage(locale: string): Promise<RegionFailure | null> {
    if (!isLocaleName(locale)) return Promise.resolve("failed");
    if (locale === this.snapshot.language) return Promise.resolve(null);
    return this.write("language", async () => {
      const current = await this.backend.readLocale().catch(() => [] as string[]);
      await this.backend.setLocale(withLanguage(current, locale));
    });
  }

  /** One write at a time; resolves to why it did not happen, or null. The system's own answer is read afterwards. */
  private async write(kind: RegionWrite, run: () => Promise<void>): Promise<RegionFailure | null> {
    if (this.snapshot.busy !== null) return "failed";
    this.publish({ busy: kind, error: null });
    let failure: RegionFailure | null = null;
    try {
      await run();
    } catch (error) {
      failure = error instanceof RegionError ? error.reason : "failed";
    }
    this.publish({ busy: null, error: failure });
    await this.refresh();
    return failure;
  }

  private publish(change: Partial<RegionState>): void {
    const next = { ...this.snapshot, ...change };
    const same = (Object.keys(next) as Array<keyof RegionState>).every((key) => Object.is(next[key], this.snapshot[key]));
    if (same) return;
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}

export const useRegion = (store: RegionStore): RegionState => useSyncExternalStore(store.subscribe, store.getSnapshot);

/** Why a write did not happen, as a sentence for a pane or a tool result. */
export function describeFailure(reason: RegionFailure): string {
  switch (reason) {
    case "denied":
      return "Not changed: the password was not accepted, or the request was cancelled.";
    case "unavailable":
      return "Not changed: this computer has no service to change it with.";
    case "failed":
      return "Not changed: the system refused.";
  }
}
