/**
 * What the Bluetooth page is made of. A backend (BlueZ over D-Bus, or the
 * stand-in development runs use) reports the adapter and every device it
 * knows; `devices.ts` turns those into the two lists a person sees. The
 * backend also carries out the person's choices and, for pairing that needs a
 * code, hands the agent's questions to a `PairingHandler` (the store).
 */

/** What a device is, as far as its icon goes. */
export type DeviceKind = "headphones" | "speaker" | "mouse" | "keyboard" | "phone" | "generic";

/** One device, as the backend read it. */
export interface RawDevice {
  /** BlueZ's object path: the handle every action takes. */
  path: string;
  /** `AA:BB:CC:DD:EE:FF`. */
  address: string;
  /** The name the device announces; null when it announces none. */
  name: string | null;
  /** The name the person (or BlueZ) gave it; null when absent. */
  alias: string | null;
  kind: DeviceKind;
  paired: boolean;
  connected: boolean;
  /** Signal strength in dBm (about -30 near, -90 far); null when not heard. */
  rssi: number | null;
  /** 0 to 100; null when the device does not report a battery. */
  battery: number | null;
}

export interface AdapterReading {
  path: string;
  powered: boolean;
  discovering: boolean;
}

/** What a backend knows right now. */
export type BluetoothReading =
  /** No Bluetooth adapter (BlueZ is there, but there is nothing to talk to). */
  { kind: "unavailable" } | { kind: "ready"; adapter: AdapterReading; devices: readonly RawDevice[] };

/** One row of either list. */
export interface BluetoothDevice {
  path: string;
  name: string;
  kind: DeviceKind;
  paired: boolean;
  connected: boolean;
  battery: number | null;
  /** The signal in dBm, rounded to a step so rows do not swap places as it jitters; null when not heard. */
  signal: number | null;
}

/** Why an action did not work, in the few ways a person can act on. */
export type Failure = "not-responding" | "refused" | "wrong-code" | "timeout" | "unavailable" | "off" | "busy" | "failed";

/** `cancelled` is the person's own doing: nothing to report. */
export type Reason = Failure | "cancelled";

export type ActionResult = { ok: true } | { ok: false; reason: Reason };

/** Pairing is several steps; if it got as far as pairing, the device is the person's now. */
export type PairResult = { ok: true } | { ok: false; reason: Reason; paired: boolean };

interface Subject {
  /** The device's object path. */
  path: string;
  /** Its name for the sheet; already cleaned of anything that could not be drawn. */
  name: string;
}

/** Questions the person answers on a sheet. */
export type AskRequest = Subject &
  /** Numeric comparison: do both sides show this code? */
  (
    | { kind: "confirm"; passkey: string }
    /** A device that wants to pair with this computer (the "just works" model). */
    | { kind: "authorize" }
    /** A legacy device that wants a PIN typed here. */
    | { kind: "enter-pin" }
    /** A device that shows a six digit code to type here. */
    | { kind: "enter-passkey" }
  );

/** Codes to read and type on the device, which may change as the device's keys are pressed. */
export type ShowRequest = Subject &
  ({ kind: "show-passkey"; passkey: string /** How many digits the device has taken so far. */; entered: number } | { kind: "show-pin"; pin: string });

export type PairingRequest = AskRequest | ShowRequest;

/** The person's answer to an `AskRequest`; `value` is the PIN or passkey typed, for the two that ask for one. */
export type Answer = { ok: true; value: string | null } | { ok: false; reason: "rejected" | "cancelled" };

/** Where the agent's questions go. */
export interface PairingHandler {
  /** Resolves when the person answers, or when the question is withdrawn (`dismiss`). */
  ask(request: AskRequest): Promise<Answer>;
  /** Shows a code to type on the device; returns at once. Called again as the device takes digits. */
  show(request: ShowRequest): void;
  /** The pairing is over or BlueZ withdrew its question: nothing is pending any more. */
  dismiss(): void;
}

export interface BluetoothBackend {
  /** Rejects when the system cannot be asked at all (no BlueZ). */
  read(): Promise<BluetoothReading>;
  /** Rejects when it cannot be done (no adapter, or BlueZ is not there). */
  setPower(on: boolean): Promise<void>;
  /** Starts looking for devices; rejects when it cannot. Looking ends with `stopDiscovery` or when the backend closes. */
  startDiscovery(): Promise<void>;
  stopDiscovery(): Promise<void>;
  connect(path: string): Promise<ActionResult>;
  disconnect(path: string): Promise<ActionResult>;
  /** Pairs, trusts so it reconnects by itself, and connects. Never rejects. */
  pair(path: string): Promise<PairResult>;
  /** Stops a pairing in progress. */
  cancelPairing(path: string): Promise<void>;
  /** Removes the pairing and everything BlueZ kept about the device. */
  forget(path: string): Promise<ActionResult>;
  /** Calls `onChange` when anything may have changed; returns the stop function. */
  watch(onChange: () => void): () => void;
  /** Where the pairing agent's questions go; null stops answering them. */
  setPairingHandler(handler: PairingHandler | null): void;
  close(): void;
}
