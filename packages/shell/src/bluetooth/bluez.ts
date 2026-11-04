/**
 * The real Bluetooth backend: BlueZ on the system bus, through the shell's
 * own D-Bus (`../dbus`). It reads the adapter and its devices
 * (`GetManagedObjects`), follows them (`InterfacesAdded`, `InterfacesRemoved`,
 * `PropertiesChanged`), looks for devices, and pairs, connects, and forgets
 * them. The pairing agent (`agent.ts`) lives on the same connection, which
 * matters: BlueZ asks the agent of whoever called `Pair`. The bus connection
 * is made when first needed and made again if it dropped.
 */

import { BUS_NAME, DBusConnection } from "../dbus/index.ts";
import { AgentRegistration } from "./agent.ts";
import { BLUEZ, BluezClient, OBJECT_MANAGER, PROPERTIES } from "./bluez-client.ts";
import { classify, type Outcome } from "./failures.ts";
import type { ActionResult, BluetoothBackend, BluetoothReading, PairingHandler, PairResult } from "./types.ts";
import { adapterOf, DEVICE_PATH, IFACE, parseManagedObjects } from "./values.ts";

export interface BluezOptions {
  /** How the system bus is reached (tests point it at a private bus). */
  connect?: () => Promise<DBusConnection>;
  /** How long a connect may take; BlueZ gives up on its own after a while. */
  connectTimeoutMs?: number;
  /** How long a pairing may take, including the person reading a code. */
  pairTimeoutMs?: number;
  /** How long the person has to answer the agent's question. */
  askTimeoutMs?: number;
}

const CONNECT_TIMEOUT_MS = 45_000;
const PAIR_TIMEOUT_MS = 95_000;

/** The interfaces whose changes the page shows; BlueZ also reports media players, GATT characteristics, and more. */
const WATCHED = new Set<string>([IFACE.adapter, IFACE.device, IFACE.battery]);

interface Session {
  client: BluezClient;
  agent: AgentRegistration;
  agentStarted: boolean;
}

export class BluezBackend implements BluetoothBackend {
  private session: Promise<Session> | null = null;
  private handler: PairingHandler | null = null;
  private readonly openBus: () => Promise<DBusConnection>;
  private closed = false;
  private complained = false;

  constructor(private readonly options: BluezOptions = {}) {
    this.openBus = options.connect ?? (() => DBusConnection.connect({ bus: "system" }));
  }

  /** The session, connecting if there is none; a connection that dropped is replaced. */
  private bluez(): Promise<Session> {
    if (this.closed) return Promise.reject(new Error("the Bluetooth backend is closed"));
    if (this.session) return this.session;
    const pending: Promise<Session> = this.openBus().then(
      (connection) => {
        const client = new BluezClient(connection);
        const agent = new AgentRegistration(
          client,
          () => this.handler,
          this.options.askTimeoutMs === undefined ? {} : { askTimeoutMs: this.options.askTimeoutMs },
        );
        const session: Session = { client, agent, agentStarted: false };
        connection.onClose(() => {
          agent.stop();
          if (this.session === pending) this.session = null;
        });
        this.startAgent(session);
        return session;
      },
      (error) => {
        if (this.session === pending) this.session = null;
        throw error;
      },
    );
    this.session = pending;
    return pending;
  }

  /** Registers the agent once there is someone to ask. Not being able to is not an error: bluetoothd may start later. */
  private startAgent(session: Session): void {
    if (!this.handler || session.agentStarted) return;
    session.agentStarted = true;
    session.agent.start().catch((error) => {
      if (this.complained) return;
      this.complained = true;
      console.error("dashi-shell: Bluetooth: no pairing agent yet:", classify(error));
    });
  }

  setPairingHandler(handler: PairingHandler | null): void {
    this.handler = handler;
    if (handler)
      void this.bluez()
        .then((session) => this.startAgent(session))
        .catch(() => {});
  }

  async read(): Promise<BluetoothReading> {
    const { client } = await this.bluez();
    return parseManagedObjects(await client.managedObjects());
  }

  /** The adapter's path; rejects when there is none. */
  private async adapter(): Promise<{ client: BluezClient; path: string }> {
    const { client } = await this.bluez();
    const reading = parseManagedObjects(await client.managedObjects());
    if (reading.kind !== "ready") throw new Error("there is no Bluetooth adapter");
    return { client, path: reading.adapter.path };
  }

  async setPower(on: boolean): Promise<void> {
    const { client, path } = await this.adapter();
    await client.setProperty(path, IFACE.adapter, "Powered", "b", on);
  }

  async startDiscovery(): Promise<void> {
    const { client, path } = await this.adapter();
    try {
      await client.call(path, IFACE.adapter, "StartDiscovery");
    } catch (error) {
      // Already looking, for us or for someone else: the same thing.
      const outcome = classify(error);
      if (outcome !== "busy" && outcome !== "already") throw error;
    }
  }

  async stopDiscovery(): Promise<void> {
    const { client, path } = await this.adapter();
    // "No discovery started" and the like: there is nothing to stop.
    await client.call(path, IFACE.adapter, "StopDiscovery").catch(() => {});
  }

  connect(path: string): Promise<ActionResult> {
    return this.deviceCall(path, "Connect", this.options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS);
  }

  disconnect(path: string): Promise<ActionResult> {
    return this.deviceCall(path, "Disconnect", this.options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS);
  }

  private async deviceCall(path: string, member: string, timeoutMs: number): Promise<ActionResult> {
    if (!DEVICE_PATH.test(path)) return { ok: false, reason: "failed" };
    try {
      const { client } = await this.bluez();
      await client.call(path, IFACE.device, member, undefined, undefined, timeoutMs);
      return { ok: true };
    } catch (error) {
      return this.failed(member, error);
    }
  }

  /** An error as the result of an action (and a line in the log, with the error's name only). */
  private failed(what: string, error: unknown): ActionResult {
    const outcome: Outcome = classify(error);
    if (outcome === "already") return { ok: true };
    if (outcome === "unreachable" || outcome === "failed")
      console.error(`dashi-shell: Bluetooth: ${what} failed:`, error instanceof Error ? error.name : "error");
    return { ok: false, reason: outcome === "unreachable" ? "failed" : outcome };
  }

  async pair(path: string): Promise<PairResult> {
    if (!DEVICE_PATH.test(path)) return { ok: false, reason: "failed", paired: false };
    let client: BluezClient;
    try {
      client = (await this.bluez()).client;
    } catch (error) {
      return { ...this.failed("pair", error), paired: false } as PairResult;
    }
    try {
      await client.call(path, IFACE.device, "Pair", undefined, undefined, this.options.pairTimeoutMs ?? PAIR_TIMEOUT_MS);
    } catch (error) {
      const result = this.failed("pair", error);
      if (!result.ok) return { ok: false, reason: result.reason, paired: false };
      // Already paired: carry on to trusting and connecting.
    }
    // Trusted, so it reconnects by itself and BlueZ stops asking whether it may use its services.
    await client.setProperty(path, IFACE.device, "Trusted", "b", true).catch((error) => {
      console.error("dashi-shell: Bluetooth: could not trust the device:", error instanceof Error ? error.name : "error");
    });
    const connected = await this.connect(path);
    return connected.ok ? { ok: true } : { ok: false, reason: connected.reason, paired: true };
  }

  async cancelPairing(path: string): Promise<void> {
    if (!DEVICE_PATH.test(path)) return;
    const { client } = await this.bluez();
    await client.call(path, IFACE.device, "CancelPairing").catch(() => {});
  }

  async forget(path: string): Promise<ActionResult> {
    if (!DEVICE_PATH.test(path)) return { ok: false, reason: "failed" };
    try {
      const { client } = await this.bluez();
      await client.call(adapterOf(path), IFACE.adapter, "RemoveDevice", "o", [path]);
      return { ok: true };
    } catch (error) {
      return this.failed("forget", error);
    }
  }

  watch(onChange: () => void): () => void {
    let stopped = false;
    const stops: Array<() => Promise<void>> = [];
    const subscribe = (rule: Parameters<DBusConnection["subscribe"]>[0], interesting: (body: unknown[]) => boolean = () => true) => {
      void this.bluez()
        .then(({ client }) => client.connection.subscribe(rule, (message) => !stopped && interesting(message.body) && onChange()))
        .then((stop) => {
          if (stopped) void stop().catch(() => {});
          else stops.push(stop);
        })
        .catch(() => {
          // No bus: the page just does not update by itself.
        });
    };
    // Devices appearing and going (the object manager lives at "/", outside /org/bluez).
    subscribe({ type: "signal", sender: BLUEZ, interface: OBJECT_MANAGER });
    subscribe(
      { type: "signal", sender: BLUEZ, interface: PROPERTIES, member: "PropertiesChanged", pathNamespace: "/org/bluez" },
      ([iface]) => typeof iface === "string" && WATCHED.has(iface),
    );
    // bluetoothd restarting takes every object with it.
    subscribe({ type: "signal", sender: BUS_NAME, interface: BUS_NAME, member: "NameOwnerChanged", path: "/org/freedesktop/DBus", args: { 0: BLUEZ } });
    return () => {
      stopped = true;
      for (const stop of stops.splice(0)) void stop().catch(() => {});
    };
  }

  close(): void {
    this.closed = true;
    const session = this.session;
    this.session = null;
    this.handler = null;
    void session
      ?.then((current) => {
        current.agent.stop();
        current.client.connection.close();
      })
      .catch(() => {});
  }
}
