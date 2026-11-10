/**
 * A stand-in for timedated and localed that keeps everything in memory, for
 * a development run: a nested shell must not change the developer's own
 * time zone or system language (`system/stand-in.ts` says when a run is one).
 */

import { canonicalLocale, localeFromEnv, parseInstalledLocales } from "../../shared/locale/index.ts";
import { isTimezoneName } from "../timezones.ts";
import { type RegionBackend, RegionError, type TimeState } from "./backend.ts";

export interface FakeRegionOptions {
  timezone?: string;
  ntp?: boolean;
  canNtp?: boolean;
  /** The system locale's variables. */
  locale?: string[];
  /** Locales "installed", as `locale -a` prints them. */
  installed?: string[];
  zones?: string[];
  /** Refuse writes the way a declined password sheet does. */
  deny?: boolean;
  /** Pretend there is no timedated or localed. */
  unavailable?: boolean;
}

const SOME_LOCALES = [
  "en_US.UTF-8",
  "en_GB.UTF-8",
  "en_CA.UTF-8",
  "en_AU.UTF-8",
  "de_DE.UTF-8",
  "de_CH.UTF-8",
  "fr_FR.UTF-8",
  "fr_CA.UTF-8",
  "es_ES.UTF-8",
  "es_MX.UTF-8",
  "it_IT.UTF-8",
  "pt_BR.UTF-8",
  "pt_PT.UTF-8",
  "nl_NL.UTF-8",
  "sv_SE.UTF-8",
  "ja_JP.UTF-8",
  "ko_KR.UTF-8",
  "zh_CN.UTF-8",
  "ru_RU.UTF-8",
  "pl_PL.UTF-8",
];

/** What `locale -a` lists on this machine, so a nested run's pickers look as long as the real ones; a short list when it cannot run. */
function machineLocales(): string[] {
  try {
    const out = Bun.spawnSync(["locale", "-a"], { stdout: "pipe", stderr: "ignore", env: { ...process.env, LC_ALL: "C" } });
    const lines = out.stdout.toString().split("\n").filter(Boolean);
    return lines.length > 0 ? lines : SOME_LOCALES;
  } catch {
    return SOME_LOCALES;
  }
}

/** The zone the process is in now. */
function currentZone(): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return isTimezoneName(zone) ? zone : "UTC";
}

export class FakeRegion implements RegionBackend {
  private time: TimeState;
  private locale: string[];
  private readonly listeners = new Set<() => void>();
  /** What was asked, in order: for tests and for a nested run's log. */
  readonly calls: Array<{ member: string; args: unknown[] }> = [];
  deny: boolean;

  constructor(private readonly options: FakeRegionOptions = {}) {
    this.time = { timezone: options.timezone ?? currentZone(), ntp: options.ntp ?? true, canNtp: options.canNtp ?? true, ntpSynced: options.ntp ?? true };
    this.locale = options.locale ?? [`LANG=${localeFromEnv(process.env, "LANG") ?? "en_US.UTF-8"}`];
    this.deny = options.deny ?? false;
  }

  private guard(member: string, args: unknown[]): void {
    this.calls.push({ member, args });
    if (this.options.unavailable) throw new RegionError("unavailable");
  }

  private guardWrite(member: string, args: unknown[]): void {
    this.guard(member, args);
    if (this.deny) throw new RegionError("denied");
  }

  async readTime(): Promise<TimeState> {
    this.guard("readTime", []);
    return { ...this.time };
  }

  async listTimezones(): Promise<string[]> {
    this.guard("listTimezones", []);
    return this.options.zones ?? Intl.supportedValuesOf("timeZone").filter(isTimezoneName);
  }

  async setTimezone(timezone: string): Promise<void> {
    this.guardWrite("setTimezone", [timezone]);
    if (!isTimezoneName(timezone)) throw new RegionError("failed");
    this.time = { ...this.time, timezone };
    this.changed();
  }

  async setNtp(on: boolean): Promise<void> {
    this.guardWrite("setNtp", [on]);
    if (!this.time.canNtp) throw new RegionError("failed");
    this.time = { ...this.time, ntp: on, ntpSynced: on };
    this.changed();
  }

  async readLocale(): Promise<string[]> {
    this.guard("readLocale", []);
    return [...this.locale];
  }

  async setLocale(assignments: readonly string[]): Promise<void> {
    this.guardWrite("setLocale", [[...assignments]]);
    this.locale = [...assignments];
    this.changed();
  }

  async installedLocales(): Promise<string[]> {
    const installed = this.options.installed ?? machineLocales();
    const mine = this.locale.map((entry) => canonicalLocale(entry.split("=")[1] ?? "")).filter((entry): entry is string => entry !== null);
    return parseInstalledLocales([...installed, ...mine].join("\n"));
  }

  watch(onChange: () => void): () => void {
    this.listeners.add(onChange);
    return () => this.listeners.delete(onChange);
  }

  close(): void {
    this.listeners.clear();
  }

  private changed(): void {
    for (const listener of this.listeners) listener();
  }
}
