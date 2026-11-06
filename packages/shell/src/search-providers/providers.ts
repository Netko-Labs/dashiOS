/**
 * The search providers the installed apps bring (ini.ts), as the launcher's
 * slow sources (launcher/budget.ts): read once at the start, each kept only
 * while its app is installed, all asked over one session-bus connection
 * made the first time one is asked. They are read from, never served: Dashi
 * borrows their results, behind its own registry (docs/actions.md).
 */

import { DBusConnection } from "../dbus/index.ts";
import { dataDirs, type Entry } from "../entries.ts";
import type { SlowSource } from "../launcher/budget.ts";
import type { SlowRow } from "../launcher/extension-rows.ts";
import { type ProviderBus, providerSource } from "./client.ts";
import { type ProviderInfo, readProviders } from "./ini.ts";

export interface SearchProvidersOptions {
  /** The data directories to look in (entries.ts `dataDirs`). */
  dirs?: readonly string[];
  /** The session bus; one is connected when first needed. */
  bus?: () => Promise<ProviderBus>;
}

export class SearchProviders {
  private readonly providers: ProviderInfo[];
  private connection: Promise<ProviderBus> | null = null;
  private cached: { entries: readonly Entry[]; sources: SlowSource<SlowRow>[] } | null = null;
  private readonly bus: () => Promise<ProviderBus>;

  constructor(options: SearchProvidersOptions = {}) {
    this.providers = readProviders(options.dirs ?? dataDirs());
    this.bus = options.bus ?? (() => this.session());
  }

  private session(): Promise<ProviderBus> {
    this.connection ??= DBusConnection.connect().then((connection) => {
      connection.onClose(() => {
        this.connection = null;
      });
      return connection;
    });
    // A failed connect is tried again next time.
    this.connection.catch(() => {
      this.connection = null;
    });
    return this.connection;
  }

  /** The providers whose app is installed, as slow sources; the same list while the apps are the same. */
  sources(entries: readonly Entry[]): SlowSource<SlowRow>[] {
    if (this.cached?.entries === entries) return this.cached.sources;
    const sources = this.providers.flatMap((info) => {
      const app = entries.find((entry) => entry.id === info.desktopId);
      return app ? [providerSource(info, { name: app.name, icon: app.icon }, this.bus)] : [];
    });
    this.cached = { entries, sources };
    return sources;
  }

  get count(): number {
    return this.providers.length;
  }

  close(): void {
    void this.connection?.then((connection) => (connection as Partial<DBusConnection>).close?.()).catch(() => {});
  }
}
