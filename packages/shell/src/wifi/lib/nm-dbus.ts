/**
 * The real Wi-Fi backend: NetworkManager on the system bus, through the
 * shell's own D-Bus (`../shared/dbus`). It reads the Wi-Fi device's access points
 * and the saved profiles, asks for scans, and joins networks; see
 * `nm-join.ts` for the last. The bus connection is made when first needed
 * and made again if it dropped.
 */

import { DBusConnection } from "../../shared/dbus/index.ts";
import { IFACE, NM, NM_PATH, NmClient, SETTINGS_PATH } from "./nm-client.ts";
import { joinNetwork } from "./nm-join.ts";
import { parseAccessPoint, parseProfile } from "./nm-values.ts";
import type { AccessPoint, JoinResult, KnownProfile, WifiBackend, WifiNetwork, WifiReading } from "../types.ts";

export interface NetworkManagerOptions {
  /** How the system bus is reached (tests point it at a private bus). */
  connect?: () => Promise<DBusConnection>;
  /** How long a scan may take before the list is shown as it is. */
  scanTimeoutMs?: number;
  pollMs?: number;
  /** How long a join may take; NetworkManager gives up on its own after about a minute. */
  joinTimeoutMs?: number;
}

const SCAN_TIMEOUT_MS = 8000;
const POLL_MS = 400;
const JOIN_TIMEOUT_MS = 45_000;
/** A saved profile's object path. */
const PROFILE_PATH = /^\/org\/freedesktop\/NetworkManager\/Settings\/\d{1,9}$/;

export class NetworkManagerBackend implements WifiBackend {
  private client: Promise<NmClient> | null = null;
  private readonly connect: () => Promise<DBusConnection>;
  private closed = false;

  constructor(private readonly options: NetworkManagerOptions = {}) {
    this.connect = options.connect ?? (() => DBusConnection.connect({ bus: "system" }));
  }

  /** The client, connecting if there is none; a connection that dropped is replaced. */
  private nm(): Promise<NmClient> {
    this.client ??= this.connect().then(
      (connection) => {
        connection.onClose(() => {
          this.client = null;
        });
        return new NmClient(connection);
      },
      (error) => {
        this.client = null;
        throw error;
      },
    );
    return this.client;
  }

  async read(): Promise<WifiReading> {
    const nm = await this.nm();
    const device = await nm.wifiDevice();
    if (!device) return { kind: "unavailable" };
    const [paths, wireless, known] = await Promise.all([
      nm.paths(device, IFACE.wireless, "GetAllAccessPoints"),
      nm.properties(device, IFACE.wireless),
      this.profiles(nm),
    ]);
    // An access point can vanish between the list and the read: skip it.
    const read = await Promise.allSettled(paths.map(async (path) => parseAccessPoint(path, await nm.properties(path, IFACE.accessPoint))));
    const aps: AccessPoint[] = read.flatMap((result) => (result.status === "fulfilled" && result.value ? [result.value] : []));
    const active = wireless.get("ActiveAccessPoint");
    return { kind: "ready", aps, known, active: typeof active === "string" && active !== "/" ? active : null };
  }

  private async profiles(nm: NmClient): Promise<KnownProfile[]> {
    const paths = await nm.paths(SETTINGS_PATH, IFACE.settings, "ListConnections");
    const read = await Promise.allSettled(
      paths.map(async (path) => {
        const [settings] = await nm.call(path, IFACE.profile, "GetSettings");
        return parseProfile(path, settings);
      }),
    );
    return read.flatMap((result) => (result.status === "fulfilled" && result.value ? [result.value] : []));
  }

  async scan(): Promise<void> {
    const nm = await this.nm();
    const device = await nm.wifiDevice();
    if (!device) return;
    const lastScan = () => nm.property(device, IFACE.wireless, "LastScan");
    const before = await lastScan();
    // NetworkManager refuses a scan right after another one: the list is fresh enough.
    try {
      await nm.call(device, IFACE.wireless, "RequestScan", "a{sv}", [new Map()]);
    } catch {
      return;
    }
    const deadline = Date.now() + (this.options.scanTimeoutMs ?? SCAN_TIMEOUT_MS);
    while (!this.closed && Date.now() < deadline) {
      await Bun.sleep(this.options.pollMs ?? POLL_MS);
      if ((await lastScan()) !== before) return;
    }
  }

  async join(network: WifiNetwork, password: string | null): Promise<JoinResult> {
    try {
      const nm = await this.nm();
      const device = await nm.wifiDevice();
      if (!device) return { ok: false, reason: "failed" };
      return await joinNetwork(nm, device, network, password, this.options.joinTimeoutMs ?? JOIN_TIMEOUT_MS);
    } catch (error) {
      console.error("dashi-shell: Wi-Fi: could not reach NetworkManager:", error instanceof Error ? error.name : "error");
      return { ok: false, reason: "failed" };
    }
  }

  async forget(profiles: readonly string[]): Promise<boolean> {
    try {
      const nm = await this.nm();
      // The paths came from NetworkManager's own list, but they are checked before they are called on.
      const paths = profiles.filter((path) => PROFILE_PATH.test(path));
      const results = await Promise.allSettled(paths.map((path) => nm.call(path, IFACE.profile, "Delete")));
      return paths.length === profiles.length && results.every((result) => result.status === "fulfilled");
    } catch (error) {
      console.error("dashi-shell: Wi-Fi: could not reach NetworkManager:", error instanceof Error ? error.name : "error");
      return false;
    }
  }

  watch(onChange: () => void): () => void {
    let stopped = false;
    let unsubscribe: (() => Promise<void>) | null = null;
    void this.nm()
      .then((nm) => nm.connection.subscribe({ type: "signal", sender: NM, pathNamespace: NM_PATH, interface: IFACE.wireless }, () => !stopped && onChange()))
      .then((stop) => {
        if (stopped) void stop().catch(() => {});
        else unsubscribe = stop;
      })
      .catch(() => {
        // No bus: the list just does not update by itself.
      });
    return () => {
      stopped = true;
      void unsubscribe?.().catch(() => {});
    };
  }

  close(): void {
    this.closed = true;
    const client = this.client;
    this.client = null;
    void client?.then((nm) => nm.connection.close()).catch(() => {});
  }
}
