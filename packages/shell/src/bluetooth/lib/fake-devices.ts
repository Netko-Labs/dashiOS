/**
 * The stand-in's devices (`fake.ts`): the person's own, and the ones nearby
 * that turn up while it "searches", each with the pairing it asks for.
 */

import type { RawDevice } from "../types.ts";
import { DEVICE_PATH, kindOf } from "./values.ts";

/** What pairing asks of the person. */
export type Pairing = { how: "just-works" } | { how: "compare"; passkey: string } | { how: "type-on-device"; passkey: string } | { how: "pin"; pin: string };

export interface Entry {
  device: RawDevice;
  pairing: Pairing;
  /** Connecting never works. */
  stubborn?: boolean;
  /** Turns up this long after a search starts; 0 is always there. */
  appearsAfterMs: number;
  /** Seen at all (the ones that appear later are not, at first). */
  seen: boolean;
}

interface EntryOptions {
  paired?: boolean;
  connected?: boolean;
  battery?: number | null;
  rssi?: number | null;
  after?: number;
  pairing?: Pairing;
  stubborn?: boolean;
}

function entry(n: number, name: string | null, icon: string | null, options: EntryOptions): Entry {
  const devicePath = `/org/bluez/hci0/dev_DA_5B_1D_00_00_${n.toString(16).padStart(2, "0").toUpperCase()}`;
  if (!DEVICE_PATH.test(devicePath)) throw new Error("the fake's device paths are not valid");
  const paired = options.paired ?? false;
  return {
    device: {
      path: devicePath,
      address: devicePath.slice(-17).replaceAll("_", ":"),
      name,
      alias: paired ? name : null,
      kind: kindOf(icon),
      paired,
      connected: options.connected ?? false,
      rssi: options.rssi ?? null,
      battery: options.battery ?? null,
    },
    pairing: options.pairing ?? { how: "just-works" },
    ...(options.stubborn ? { stubborn: true } : {}),
    appearsAfterMs: options.after ?? 0,
    seen: (options.after ?? 0) === 0,
  };
}

export function makeEntries(): Entry[] {
  let n = 0;
  const next = (name: string | null, icon: string | null, options: EntryOptions = {}): Entry => entry(++n, name, icon, options);
  return [
    // The person's own.
    next("AirPods Pro", "audio-headphones", { paired: true, connected: true, battery: 82, rssi: -45 }),
    next("Magic Mouse", "input-mouse", { paired: true, battery: 41 }),
    next("Keychron K2", "input-keyboard", { paired: true, connected: true, battery: 100, rssi: -52 }),
    next("Pixel 8", "phone", { paired: true }),
    // Nearby, turning up over the first seconds of a search.
    next("Sony WH-1000XM5", "audio-headset", { rssi: -48, after: 400 }),
    next("Galaxy S24", "phone", { rssi: -57, after: 800, pairing: { how: "compare", passkey: "123456" } }),
    next("JBL Flip 6", "audio-card", { rssi: -63, after: 1200 }),
    next("Logitech K380", "input-keyboard", { rssi: -66, after: 1600, pairing: { how: "type-on-device", passkey: "482913" } }),
    next("Retro Gamepad", "input-gaming", { rssi: -71, after: 2000, pairing: { how: "pin", pin: "0000" } }),
    next("Dead Speaker", "audio-card", { rssi: -74, after: 2400, stubborn: true }),
    // Announces no name: not listed.
    next(null, null, { rssi: -40, after: 1000 }),
  ];
}
