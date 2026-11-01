/**
 * timedated and localed on the system bus, through the shell's own D-Bus
 * (`../dbus`). Every write passes `interactive: true`, so when the person
 * is not allowed to change the setting outright, polkitd asks the shell's
 * authentication agent (`../polkit`), which shows the password sheet; no
 * password ever passes through here. The bus connection is made when first
 * needed and made again if it dropped.
 */

import { DBusConnection, DBusError } from "../dbus/index.ts";
import { propertyMap, unwrap } from "../dbus/properties.ts";
import { type RegionBackend, RegionError, type TimeState } from "./backend.ts";
import { parseInstalledLocales } from "./locale.ts";
import { isTimezoneName } from "./timezones.ts";

export const TIMEDATE = { name: "org.freedesktop.timedate1", path: "/org/freedesktop/timedate1" } as const;
export const LOCALE = { name: "org.freedesktop.locale1", path: "/org/freedesktop/locale1" } as const;
const PROPERTIES = "org.freedesktop.DBus.Properties";

/** polkit's refusals as they reach a caller: the person said no, or closed the sheet. */
const DENIED = [
  "org.freedesktop.DBus.Error.AccessDenied",
  "org.freedesktop.PolicyKit1.Error.NotAuthorized",
  "org.freedesktop.PolicyKit1.Error.Cancelled",
  "org.freedesktop.PolicyKit1.Error.Failed",
];
const UNAVAILABLE = [
  "org.freedesktop.DBus.Error.ServiceUnknown",
  "org.freedesktop.DBus.Error.NameHasNoOwner",
  "org.freedesktop.DBus.Error.UnknownObject",
  "org.freedesktop.DBus.Error.Disconnected",
  "org.freedesktop.DBus.Error.NoServer",
];

/** What a failed call comes to for the panes; never the message text (it can carry paths). */
export function failure(error: unknown): RegionError {
  if (error instanceof RegionError) return error;
  if (error instanceof DBusError) {
    if (DENIED.includes(error.errorName)) return new RegionError("denied");
    if (UNAVAILABLE.includes(error.errorName)) return new RegionError("unavailable");
  }
  // No bus at all (`disabled:`, no socket): the same as no service.
  if (error instanceof Error && /no usable D-Bus address|ENOENT|ECONNREFUSED/.test(error.message)) return new RegionError("unavailable");
  return new RegionError("failed");
}

export interface SystemdOptions {
  /** How the system bus is reached (tests point it at a private bus). */
  connect?: () => Promise<DBusConnection>;
  /** The UTF-8 locales installed; `locale -a` unless a test supplies them. */
  locales?: () => Promise<string[]>;
}

/** Runs `locale -a`; an empty list when it cannot run. */
async function localeCommand(): Promise<string[]> {
  try {
    const child = Bun.spawn(["locale", "-a"], { stdin: "ignore", stdout: "pipe", stderr: "ignore", timeout: 5000, env: { ...process.env, LC_ALL: "C" } });
    const [stdout] = await Promise.all([new Response(child.stdout).text(), child.exited]);
    return parseInstalledLocales(stdout);
  } catch {
    return [];
  }
}

export class SystemdBackend implements RegionBackend {
  private connection: Promise<DBusConnection> | null = null;
  private readonly connect: () => Promise<DBusConnection>;
  private closed = false;

  constructor(private readonly options: SystemdOptions = {}) {
    this.connect = options.connect ?? (() => DBusConnection.connect({ bus: "system" }));
  }

  private bus(): Promise<DBusConnection> {
    this.connection ??= this.connect().then(
      (connection) => {
        connection.onClose(() => {
          this.connection = null;
        });
        return connection;
      },
      (error) => {
        this.connection = null;
        throw error;
      },
    );
    return this.connection;
  }

  private async call(target: { name: string; path: string }, interfaceName: string, member: string, signature?: string, body?: readonly unknown[]): Promise<unknown[]> {
    try {
      const bus = await this.bus();
      return await bus.call({ destination: target.name, path: target.path, interface: interfaceName, member, ...(signature === undefined ? {} : { signature, body: body ?? [] }) });
    } catch (error) {
      throw failure(error);
    }
  }

  private async properties(target: { name: string; path: string }): Promise<Map<string, unknown>> {
    const [reply] = await this.call(target, PROPERTIES, "GetAll", "s", [target.name]);
    const properties = propertyMap(reply);
    if (!properties) throw new RegionError("failed");
    return properties;
  }

  async readTime(): Promise<TimeState> {
    const properties = await this.properties(TIMEDATE);
    const timezone = properties.get("Timezone");
    return {
      timezone: isTimezoneName(timezone) ? timezone : "UTC",
      ntp: properties.get("NTP") === true,
      canNtp: properties.get("CanNTP") === true,
      ntpSynced: properties.get("NTPSynchronized") === true,
    };
  }

  async listTimezones(): Promise<string[]> {
    const [reply] = await this.call(TIMEDATE, TIMEDATE.name, "ListTimezones");
    return Array.isArray(reply) ? reply.filter(isTimezoneName) : [];
  }

  async setTimezone(timezone: string): Promise<void> {
    if (!isTimezoneName(timezone)) throw new RegionError("failed");
    await this.call(TIMEDATE, TIMEDATE.name, "SetTimezone", "sb", [timezone, true]);
  }

  async setNtp(on: boolean): Promise<void> {
    await this.call(TIMEDATE, TIMEDATE.name, "SetNTP", "bb", [on, true]);
  }

  async readLocale(): Promise<string[]> {
    const [reply] = await this.call(LOCALE, PROPERTIES, "Get", "ss", [LOCALE.name, "Locale"]);
    const value = unwrap(reply);
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
  }

  async setLocale(assignments: readonly string[]): Promise<void> {
    await this.call(LOCALE, LOCALE.name, "SetLocale", "asb", [[...assignments], true]);
  }

  installedLocales(): Promise<string[]> {
    return (this.options.locales ?? localeCommand)();
  }

  watch(onChange: () => void): () => void {
    let stopped = false;
    const stops: Array<() => Promise<void>> = [];
    void this.bus()
      .then(async (bus) => {
        for (const target of [TIMEDATE, LOCALE]) {
          const stop = await bus.subscribe({ type: "signal", sender: target.name, path: target.path, interface: PROPERTIES, member: "PropertiesChanged" }, () => !stopped && onChange());
          if (stopped) void stop().catch(() => {});
          else stops.push(stop);
        }
      })
      .catch(() => {
        // No bus: the panes just do not update by themselves.
      });
    return () => {
      stopped = true;
      for (const stop of stops.splice(0)) void stop().catch(() => {});
    };
  }

  close(): void {
    this.closed = true;
    const connection = this.connection;
    this.connection = null;
    void connection?.then((bus) => bus.close()).catch(() => {});
  }

  /** Whether `close` ran (the store does not reconnect after it). */
  get isClosed(): boolean {
    return this.closed;
  }
}
