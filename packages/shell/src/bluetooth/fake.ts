/**
 * A pretend Bluetooth, for development runs. A shell nested in a window on a
 * developer's machine must never touch that machine's real Bluetooth:
 * clicking a device would disconnect their own headphones, and a search
 * would show their neighbors' phones. So the nested run (see `select.ts`)
 * gets this instead of BlueZ: a few devices that are already paired, a few
 * that turn up while "searching", and a pairing for each way BlueZ can ask:
 * nothing, a code to compare, a code to type on the device, a PIN to type
 * here, and a speaker that pairs and then will not connect. The radio is only
 * a flag, and everything takes a moment.
 */

import type { Radio } from "../control-center/radios.ts";
import { type Entry, makeEntries } from "./fake-devices.ts";
import type { ActionResult, AdapterReading, BluetoothBackend, BluetoothReading, PairingHandler, PairResult } from "./types.ts";

export interface FakeBluetoothOptions {
  /** How long a connect, disconnect, or forget takes. */
  actionMs?: number;
  /** How long a pairing takes once its codes are settled. */
  pairMs?: number;
  /** Scales how long nearby devices take to turn up (0 shows them at once). */
  searchSpeed?: number;
}

interface Session {
  cancelled: boolean;
  wake(): void;
}

export class FakeBluetooth implements BluetoothBackend {
  private powered = true;
  private discovering = false;
  private readonly entries = makeEntries();
  private readonly watchers = new Set<() => void>();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly sessions = new Map<string, Session>();
  private handler: PairingHandler | null = null;
  /** Connected before the radio went off: they reconnect when it comes back, like trusted devices do. */
  private readonly returning = new Set<string>();

  constructor(private readonly options: FakeBluetoothOptions = {}) {}

  /** The radio switch, for Control Center's Bluetooth tile. */
  readonly radio: Radio = {
    read: async () => this.powered,
    set: async (on) => this.power(on),
  };

  private visible(): Entry[] {
    return this.entries.filter((candidate) => candidate.seen || candidate.device.paired);
  }

  async read(): Promise<BluetoothReading> {
    const adapter: AdapterReading = { path: "/org/bluez/hci0", powered: this.powered, discovering: this.discovering };
    return { kind: "ready", adapter, devices: this.visible().map(({ device }) => ({ ...device })) };
  }

  async setPower(on: boolean): Promise<void> {
    this.power(on);
  }

  private power(on: boolean): void {
    if (on === this.powered) return;
    this.powered = on;
    if (!on) {
      this.discovering = false;
      this.clearTimers();
      for (const { device } of this.entries) {
        if (device.connected) this.returning.add(device.path);
        device.connected = false;
      }
    } else {
      for (const { device } of this.entries) {
        if (this.returning.delete(device.path)) this.later(800, () => this.connectNow(device.path));
      }
    }
    this.changed();
  }

  private connectNow(devicePath: string): void {
    const found = this.entries.find(({ device }) => device.path === devicePath);
    if (found && this.powered && found.device.paired) {
      found.device.connected = true;
      this.changed();
    }
  }

  async startDiscovery(): Promise<void> {
    if (!this.powered) throw new Error("the adapter is off");
    if (this.discovering) return;
    this.discovering = true;
    const speed = this.options.searchSpeed ?? 1;
    for (const found of this.entries) {
      if (found.seen) continue;
      this.later(found.appearsAfterMs * speed, () => {
        found.seen = true;
        this.changed();
      });
    }
    this.changed();
  }

  async stopDiscovery(): Promise<void> {
    if (!this.discovering) return;
    this.discovering = false;
    this.clearTimers();
    this.changed();
  }

  async connect(devicePath: string): Promise<ActionResult> {
    const found = this.find(devicePath);
    if (!found || !this.powered) return { ok: false, reason: this.powered ? "failed" : "off" };
    await Bun.sleep(this.options.actionMs ?? 900);
    if (found.stubborn) return { ok: false, reason: "not-responding" };
    found.device.connected = true;
    this.changed();
    return { ok: true };
  }

  async disconnect(devicePath: string): Promise<ActionResult> {
    const found = this.find(devicePath);
    if (!found) return { ok: false, reason: "failed" };
    await Bun.sleep(this.options.actionMs ?? 900);
    found.device.connected = false;
    this.changed();
    return { ok: true };
  }

  async pair(devicePath: string): Promise<PairResult> {
    const found = this.find(devicePath);
    const handler = this.handler;
    if (!found || !handler || !this.powered) return { ok: false, reason: this.powered ? "failed" : "off", paired: false };
    const { name } = found.device;
    const subject = { path: devicePath, name: name ?? found.device.address };
    const session: Session = { cancelled: false, wake: () => {} };
    this.sessions.set(devicePath, session);
    const cancelled = (): PairResult => ({ ok: false, reason: "cancelled", paired: false });
    try {
      const { pairing } = found;
      if (pairing.how === "compare") {
        const answer = await handler.ask({ ...subject, kind: "confirm", passkey: pairing.passkey });
        if (!answer.ok) return cancelled();
      } else if (pairing.how === "pin") {
        const answer = await handler.ask({ ...subject, kind: "enter-pin" });
        if (!answer.ok) return cancelled();
        if (answer.value !== pairing.pin) return { ok: false, reason: "wrong-code", paired: false };
      } else if (pairing.how === "type-on-device") {
        // The person types the code on the device, one digit at a time.
        for (let entered = 0; entered <= pairing.passkey.length; entered++) {
          handler.show({ ...subject, kind: "show-passkey", passkey: pairing.passkey, entered });
          await this.pause(session, entered === 0 ? 1800 : 350);
          if (session.cancelled) return cancelled();
        }
      }
      await this.pause(session, this.options.pairMs ?? 700);
      if (session.cancelled) return cancelled();
      found.device.paired = true;
      found.device.alias = found.device.name;
      this.changed();
      // Trusted now; then connected.
      const connected = await this.connect(devicePath);
      return connected.ok ? { ok: true } : { ok: false, reason: connected.reason, paired: true };
    } finally {
      this.sessions.delete(devicePath);
    }
  }

  async cancelPairing(devicePath: string): Promise<void> {
    const session = this.sessions.get(devicePath);
    if (!session) return;
    session.cancelled = true;
    session.wake();
  }

  /** Waits `ms`, or until the pairing is cancelled. */
  private pause(session: Session, ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      session.wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }

  async forget(devicePath: string): Promise<ActionResult> {
    const found = this.find(devicePath);
    if (!found) return { ok: true };
    await Bun.sleep(this.options.actionMs ?? 900);
    // BlueZ keeps what it heard of a device in range: it is nearby again, not paired.
    found.device.paired = false;
    found.device.connected = false;
    found.device.alias = null;
    found.device.rssi ??= -60;
    found.seen = true;
    this.changed();
    return { ok: true };
  }

  watch(onChange: () => void): () => void {
    this.watchers.add(onChange);
    return () => void this.watchers.delete(onChange);
  }

  setPairingHandler(handler: PairingHandler | null): void {
    this.handler = handler;
  }

  close(): void {
    this.clearTimers();
    this.watchers.clear();
    for (const session of this.sessions.values()) {
      session.cancelled = true;
      session.wake();
    }
  }

  private find(devicePath: string): Entry | undefined {
    return this.entries.find(({ device }) => device.path === devicePath);
  }

  private later(ms: number, work: () => void): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      work();
    }, ms);
    this.timers.add(timer);
  }

  private clearTimers(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }

  private changed(): void {
    for (const watcher of this.watchers) watcher();
  }
}
