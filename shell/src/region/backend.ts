/**
 * What the Date & Time and Language & Region panes ask of the system:
 * systemd-timedated (`org.freedesktop.timedate1`) and systemd-localed
 * (`org.freedesktop.locale1`), behind an interface so a development run can
 * use a stand-in that touches nothing of the machine (fake.ts).
 */

export interface TimeState {
  /** The IANA name of the system time zone. */
  timezone: string;
  /** Whether the clock is set from the network (timedated's `NTP`). */
  ntp: boolean;
  /** Whether a time-sync service is installed to turn on (`CanNTP`). */
  canNtp: boolean;
  ntpSynced: boolean;
}

/** Why a change did not happen: the person said no (or never answered the password sheet), or the system could not. */
export type RegionFailure = "denied" | "unavailable" | "failed";

export class RegionError extends Error {
  constructor(
    readonly reason: RegionFailure,
    message = reason,
  ) {
    super(message);
    this.name = "RegionError";
  }
}

export interface RegionBackend {
  readTime(): Promise<TimeState>;
  listTimezones(): Promise<string[]>;
  /** `org.freedesktop.timedate1.SetTimezone(tz, interactive: true)`: polkit asks the person through the shell's agent. */
  setTimezone(timezone: string): Promise<void>;
  /** `SetNTP(on, interactive: true)`. */
  setNtp(on: boolean): Promise<void>;
  /** The system locale's variables (`["LANG=en_US.UTF-8", "LC_TIME=…"]`). */
  readLocale(): Promise<string[]>;
  /** `org.freedesktop.locale1.SetLocale(assignments, interactive: true)`; replaces the whole set. */
  setLocale(assignments: readonly string[]): Promise<void>;
  /** The UTF-8 locales generated on this system (`locale -a`). */
  installedLocales(): Promise<string[]>;
  /** `onChange` hears the system's own changes (another program, a reconnect); returns the stop function. */
  watch(onChange: () => void): () => void;
  close(): void;
}
