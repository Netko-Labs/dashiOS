/**
 * The Bluetooth page's state, as a store React components subscribe to.
 * Opening the page reads the devices and starts looking for new ones; closing
 * it (or a minute passing) stops looking, because a scanning radio costs
 * power and bandwidth that audio shares. Actions are one at a time per
 * device, and a failure stays until the next try so the page can say what
 * happened. The store is also the pairing agent's voice: BlueZ's questions
 * (does this code match? what is the PIN?) become `prompt`, and the sheet's
 * answer goes back to BlueZ.
 */

import { useSyncExternalStore } from "react";
import { buildLists } from "./lib/devices.ts";
import { Discovery } from "./lib/discovery.ts";
import { INITIAL } from "./lib/state.ts";
import type {
  Action,
  ActionResult,
  Answer,
  AskRequest,
  BluetoothBackend,
  BluetoothDevice,
  BluetoothState,
  BluetoothStoreOptions,
  Busy,
  Failed,
  PairingHandler,
  PairResult,
  ShowRequest,
} from "./types.ts";

const THROTTLE_MS = 400;

export class BluetoothStore implements PairingHandler {
  private snapshot: BluetoothState = INITIAL;
  private readonly listeners = new Set<() => void>();
  /** Counts reads so a slow, older one cannot overwrite a newer one. */
  private reads = 0;
  private stopWatching: (() => void) | null = null;
  private throttle: ReturnType<typeof setTimeout> | undefined;
  private isOpen = false;
  private wasPowered = false;
  private readonly discovery: Discovery;
  /** Answers the question on the sheet, if it is one. */
  private asking: ((answer: Answer) => void) | null = null;
  /** Devices whose pairing the person backed out of: not a failure to report. */
  private readonly declined = new Set<string>();
  private complained = false;

  constructor(
    private readonly backend: BluetoothBackend,
    private readonly options: BluetoothStoreOptions = {},
  ) {
    this.discovery = new Discovery(
      backend,
      () => this.isOpen && this.snapshot.available === true && this.snapshot.powered,
      (looking) => this.publish({ discovering: looking }),
      options.discoveryMs,
    );
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): BluetoothState => this.snapshot;

  /** The page opened: read, look for devices, and follow changes until `close`. */
  open(): void {
    this.isOpen = true;
    this.discovery.renew();
    this.stopWatching ??= this.backend.watch(() => this.schedule());
    void this.refresh();
  }

  close(): void {
    this.isOpen = false;
    this.stopWatching?.();
    this.stopWatching = null;
    clearTimeout(this.throttle);
    this.throttle = undefined;
    if (this.discovery.active) void this.discovery.stop();
    // An old failure is not news the next time the page opens.
    if (this.snapshot.failure) this.publish({ failure: null });
  }

  /** Looks for devices again after the minute was up. */
  searchAgain(): void {
    this.discovery.renew();
    this.discovery.sync();
  }

  async refresh(): Promise<void> {
    const read = ++this.reads;
    try {
      const reading = await this.backend.read();
      if (read !== this.reads) return;
      this.complained = false;
      if (reading.kind === "unavailable") {
        this.unavailable();
      } else {
        const { mine, nearby } = buildLists(reading.devices);
        const { powered } = reading.adapter;
        // Switching the radio back on is a request to look again.
        if (powered && !this.wasPowered) this.discovery.renew();
        this.wasPowered = powered;
        // BlueZ stops looking when the radio goes off.
        if (!powered) this.discovery.forget();
        this.publish({ available: true, powered, mine, nearby });
      }
    } catch (error) {
      if (read !== this.reads) return;
      if (!this.complained) console.error("dashi-shell: Bluetooth: BlueZ cannot be asked:", error instanceof Error ? error.name : "error");
      this.complained = true;
      this.unavailable();
    }
    this.discovery.sync();
  }

  /** Picking a device in either list: connects or disconnects one that is the person's, pairs one that is not. */
  choose(device: BluetoothDevice): Promise<unknown> {
    if (device.paired || device.connected) return device.connected ? this.disconnect(device) : this.connect(device);
    return this.pair(device);
  }

  connect(device: BluetoothDevice): Promise<ActionResult> {
    return this.act(device, "connecting", "connect", () => this.backend.connect(device.path));
  }

  disconnect(device: BluetoothDevice): Promise<ActionResult> {
    return this.act(device, "disconnecting", "disconnect", () => this.backend.disconnect(device.path));
  }

  forget(device: BluetoothDevice): Promise<ActionResult> {
    return this.act(device, "forgetting", "forget", () => this.backend.forget(device.path));
  }

  /** Pairs, trusts, and connects. Only one pairing at a time: the sheet is one sheet. */
  async pair(device: BluetoothDevice): Promise<PairResult> {
    if (!this.begin(device, "pairing")) return { ok: false, reason: "busy", paired: false };
    this.declined.delete(device.path);
    let result: PairResult;
    try {
      result = await this.backend.pair(device.path);
    } catch {
      result = { ok: false, reason: "failed", paired: false };
    }
    // Whatever it was still asking or showing is moot now.
    this.dismiss(device.path);
    if (!result.ok && !result.paired && this.declined.delete(device.path)) result = { ok: false, reason: "cancelled", paired: false };
    this.declined.delete(device.path);
    await this.refresh();
    this.end(
      device.path,
      result.ok || result.reason === "cancelled"
        ? null
        : { path: device.path, name: device.name, action: "pair", reason: result.reason, paired: result.paired },
    );
    return result;
  }

  /** The failure has been seen. */
  dismissFailure(): void {
    if (this.snapshot.failure) this.publish({ failure: null });
  }

  // The agent's side: BlueZ asks, the sheet answers.

  ask(request: AskRequest): Promise<Answer> {
    // A newer question replaces an unanswered older one on the same sheet.
    this.resolve({ ok: false, reason: "cancelled" });
    return new Promise<Answer>((resolve) => {
      this.asking = resolve;
      this.publish({ prompt: request });
    });
  }

  show(request: ShowRequest): void {
    this.resolve({ ok: false, reason: "cancelled" });
    this.publish({ prompt: request });
  }

  /** `path` limits it to that device's sheet; without, whatever is up goes. */
  dismiss(path?: string): void {
    const prompt = this.snapshot.prompt;
    if (path !== undefined && prompt?.path !== path) return;
    this.resolve({ ok: false, reason: "cancelled" });
    this.publish({ prompt: null });
  }

  /** The sheet's Pair (or Enter): the person said yes, with the PIN or passkey if one was asked for. */
  answer(value: string | null = null): void {
    if (!this.asking) return;
    this.resolve({ ok: true, value });
    this.publish({ prompt: null });
  }

  /** The sheet's Cancel (or Esc): the person said no, or gave up on a code they were meant to type. */
  decline(): void {
    const prompt = this.snapshot.prompt;
    if (!prompt) return;
    this.declined.add(prompt.path);
    if (this.asking) this.resolve({ ok: false, reason: "rejected" });
    else void this.backend.cancelPairing(prompt.path).catch(() => {});
    this.publish({ prompt: null });
  }

  /** Answers the question on the sheet, if it is one. */
  private resolve(answer: Answer): void {
    const resolve = this.asking;
    this.asking = null;
    resolve?.(answer);
  }

  // Actions.

  private async act(device: BluetoothDevice, busy: Busy, action: Action, work: () => Promise<ActionResult>): Promise<ActionResult> {
    if (!this.begin(device, busy)) return { ok: false, reason: "busy" };
    let result: ActionResult;
    try {
      result = await work();
    } catch {
      result = { ok: false, reason: "failed" };
    }
    await this.refresh();
    this.end(
      device.path,
      result.ok || result.reason === "cancelled" ? null : { path: device.path, name: device.name, action, reason: result.reason, paired: device.paired },
    );
    return result;
  }

  private begin(device: BluetoothDevice, phase: Busy): boolean {
    const { busy } = this.snapshot;
    if (busy[device.path] !== undefined) return false;
    if (phase === "pairing" && Object.values(busy).includes("pairing")) return false;
    this.publish({ busy: { ...busy, [device.path]: phase }, failure: null });
    return true;
  }

  private end(path: string, failure: Failed | null): void {
    const busy = Object.fromEntries(Object.entries(this.snapshot.busy).filter(([other]) => other !== path));
    this.publish({ busy, ...(failure ? { failure } : {}) });
  }

  // Following BlueZ.

  private unavailable(): void {
    this.wasPowered = false;
    this.discovery.forget();
    this.publish({ available: false, powered: false, mine: [], nearby: [] });
  }

  /** A change in BlueZ is one read, however many signals say so: during a search they come several times a second. */
  private schedule(): void {
    if (this.throttle !== undefined) return;
    this.throttle = setTimeout(() => {
      this.throttle = undefined;
      void this.refresh();
    }, this.options.throttleMs ?? THROTTLE_MS);
  }

  private publish(change: Partial<BluetoothState>): void {
    const next = { ...this.snapshot, ...change };
    // Replaced only on a change: useSyncExternalStore re-renders on every new object.
    if (JSON.stringify(next) === JSON.stringify(this.snapshot)) return;
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}

export function useBluetooth(store: BluetoothStore): BluetoothState {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
