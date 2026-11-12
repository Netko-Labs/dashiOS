/**
 * The radios as settings with state: Wi-Fi at `dashi://settings/network/wi-fi`
 * and Bluetooth at `dashi://settings/bluetooth/bluetooth`, read from and
 * written to the same store Control Center's tiles use (control-center/
 * devices.ts), so the launcher's switch and the tile never disagree. A
 * machine without the hardware has no row (the store reads null there).
 * Agents have their own Wi-Fi and Bluetooth tools; these are the person's.
 */

import { formatAddress } from "./address.ts";
import { type ActionDef, type ActionSource, failed, invalid, ok, ready } from "./types.ts";

export interface RadioDeps {
  /** The radios now; null when the machine has none (or it can't be asked). */
  wifi(): boolean | null;
  bluetooth(): boolean | null;
  /** The Wi-Fi network the machine is on, if any. */
  network(): string | null;
  setWifi(on: boolean): Promise<void>;
  setBluetooth(on: boolean): Promise<void>;
  /** Hear that any of the above changed. */
  subscribe(listener: () => void): () => void;
}

interface Radio {
  pane: string;
  row: string;
  title: string;
  words: readonly string[];
  read(deps: RadioDeps): boolean | null;
  write(deps: RadioDeps, on: boolean): Promise<void>;
  /** What the row says after its title. */
  detail(deps: RadioDeps, on: boolean | null): string;
}

const RADIOS: readonly Radio[] = [
  {
    pane: "network",
    row: "wi-fi",
    title: "Wi-Fi",
    words: ["wifi", "wireless", "wlan", "internet", "network"],
    read: (deps) => deps.wifi(),
    write: (deps, on) => deps.setWifi(on),
    detail: (deps, on) => (on ? (deps.network() ?? "Not connected") : "Off"),
  },
  {
    pane: "bluetooth",
    row: "bluetooth",
    title: "Bluetooth",
    words: ["bt", "wireless", "headphones", "pairing"],
    read: (deps) => deps.bluetooth(),
    write: (deps, on) => deps.setBluetooth(on),
    detail: (_deps, on) => (on ? "On" : "Off"),
  },
];

/** One radio's row: run with no `value` to flip it, or with true or false. */
export function radioAction(radio: Radio, deps: RadioDeps): ActionDef {
  const set = async (on: boolean) => {
    await radio.write(deps, on);
    return ok(`${radio.title} is ${on ? "on" : "off"}.`);
  };
  return {
    address: formatAddress(["settings", radio.pane, radio.row]),
    title: radio.title,
    // Read when the row is drawn: the network can change while the launcher is open.
    get description() {
      return radio.detail(deps, radio.read(deps));
    },
    keywords: { en: [radio.title.toLowerCase(), ...radio.words] },
    kind: "toggle",
    properties: { value: { type: "boolean", description: "On or off; left out, it switches." } },
    scope: null,
    readOnly: false,
    destructive: false,
    idempotent: false,
    who: "person",
    source: "controls",
    place: { pane: radio.pane, row: radio.row },
    state: () => radio.read(deps),
    check(args) {
      if (args.value !== undefined && typeof args.value !== "boolean") return invalid("`value` must be true or false.");
      return ready(async () => {
        const now = radio.read(deps);
        if (now === null) return failed(`${radio.title} isn't on this computer.`);
        return set(typeof args.value === "boolean" ? args.value : !now);
      });
    },
  };
}

/** The radios this machine has, as a source that changes when one comes or goes. */
export class RadioSource implements ActionSource {
  readonly id = "controls";
  private readonly all: ActionDef[];
  private current: ActionDef[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly off: () => void;

  constructor(private readonly deps: RadioDeps) {
    this.all = RADIOS.map((radio) => radioAction(radio, deps));
    this.current = this.present();
    this.off = deps.subscribe(() => {
      const next = this.present();
      if (next.length === this.current.length && next.every((action, index) => action === this.current[index])) return;
      this.current = next;
      for (const listener of this.listeners) listener();
    });
  }

  private present(): ActionDef[] {
    return this.all.filter((_action, index) => (RADIOS[index] as Radio).read(this.deps) !== null);
  }

  actions = (): readonly ActionDef[] => this.current;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  close(): void {
    this.off();
  }
}
