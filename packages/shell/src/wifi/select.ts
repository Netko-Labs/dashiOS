/**
 * Which Wi-Fi the shell talks to: NetworkManager, or the stand-in.
 *
 * A development run gets the stand-in, never NetworkManager, so joining a
 * network or scanning from it cannot touch the developer's own connection
 * (`system/stand-in.ts` says when a run is one, and how to override it).
 */

import type { Network } from "../system/network.ts";
import { type Nesting, standsIn } from "../system/stand-in.ts";
import { type FakeOptions, FakeWifi } from "./fake.ts";
import { NetworkManagerBackend } from "./nm-dbus.ts";
import type { WifiBackend, WifiRadio } from "./types.ts";

/** What the shell is wired to. */
export interface WifiSetup {
  backend: WifiBackend;
  /** The radio's switch; null leaves it to `nmcli`. */
  radio: WifiRadio | null;
  /** The network for the menu bar, when the stand-in supplies it; null leaves it to `nmcli`. */
  status: (() => Network) | null;
  /** Tells the menu bar the stand-in's network changed (in place of `nmcli monitor`); returns the stop function. */
  monitor: ((onChange: () => void) => () => void) | null;
  fake: boolean;
}

export function chooseWifi(env: Record<string, string | undefined> = process.env, nesting?: Nesting, standIn: FakeOptions = {}): WifiSetup {
  if (standsIn(env, nesting)) {
    console.error("dashi-shell: Wi-Fi is a stand-in here (this is a development run; DASHI_FAKE_NM=0 uses NetworkManager)");
    const fake = new FakeWifi(standIn);
    return { backend: fake, radio: fake.radio, status: () => fake.status(), monitor: (onChange) => fake.watch(onChange), fake: true };
  }
  return { backend: new NetworkManagerBackend(), radio: null, status: null, monitor: null, fake: false };
}
