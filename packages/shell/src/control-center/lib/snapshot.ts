/**
 * The machine as Control Center's tiles see it (catalog.ts `ControlSnapshot`),
 * read from the stores the panel is given: the radios and sliders
 * (devices.ts), the switches (shared/control-center/flags.ts), the network and the battery
 * (system/store.ts), Bluetooth's devices, and the laptop's power modes,
 * keyboard light and graphics card, whether the screens mirror, and what a
 * player plays (the widgets' MPRIS source, for the Now Playing tile).
 */

import { useSyncExternalStore } from "react";
import { batteryTime } from "../../battery/panel-numbers.ts";
import type { BluetoothStore } from "../../bluetooth/store.ts";
import { type MirrorStore, useMirror } from "../../display-config/mirror.ts";
import { cardState, type GraphicsController, shownMode } from "../../graphics/controller.ts";
import { GRAPHICS_LABEL } from "../../graphics/policy.ts";
import type { Laptop } from "../../laptop/start.ts";
import { keyboardLight, type LaptopSnapshot, lightLabel } from "../../laptop/store.ts";
import type { ModeSnapshot } from "../../power/modes/store.ts";
import { type FlagsStore, useFlags } from "../../shared/control-center/index.ts";
import { type SystemStore, useSystem } from "../../system/store.ts";
import type { ControlSnapshot } from "../catalog.ts";
import { type DeviceStore, useDevices } from "../devices.ts";

const NONE = { subscribe: () => () => {}, getSnapshot: () => null };

function useStore<T>(store: { subscribe: (listener: () => void) => () => void; getSnapshot: () => T } | null): T | null {
  const source = store ?? NONE;
  return useSyncExternalStore(source.subscribe, source.getSnapshot) as T | null;
}

export interface SnapshotSources {
  devices: DeviceStore;
  flags: FlagsStore;
  system: SystemStore;
  bluetooth: BluetoothStore;
  laptop?: Laptop;
  /** The charge limit in percent now; null without one. */
  chargeLimit?: () => number | null;
  /** Mirroring the screens; without it there is no Mirroring tile. */
  mirror?: MirrorStore;
  /** What a player plays (widgets/lib/sources/media.ts); without it there is no Now Playing tile. */
  media?: NowPlayingSource;
}

/** The player Control Center reads and drives (CC-7): the widgets' `Media`. */
export interface NowPlayingSource {
  subscribe(listener: () => void): () => void;
  getSnapshot(): { title: string; artist: string; name: string; playing: boolean; art: string } | null;
  command(member: "PlayPause" | "Next" | "Previous"): Promise<void>;
  /** Brings the player's window forward. */
  raise?(): Promise<void>;
}

/** The tile's words and cover from what plays: "Harbour Lights · Helium"; a cover only as a local file. */
export function nowPlaying(playing: ReturnType<NowPlayingSource["getSnapshot"]>): ControlSnapshot["playing"] {
  if (!playing) return null;
  const cover = playing.art.startsWith("file://") ? decodeURIComponent(playing.art.slice("file://".length)) : null;
  return { title: playing.title, detail: [playing.artist, playing.name].filter((part) => part !== "").join(" · "), playing: playing.playing, cover };
}

/** The graphics tile's words, as the laptop row had them. */
function graphicsTile(graphics: GraphicsController | undefined, snapshot: ReturnType<GraphicsController["getSnapshot"]> | null): ControlSnapshot["graphics"] {
  if (!graphics || !snapshot || !snapshot.hasCard || !(snapshot.switchable || snapshot.lost)) return null;
  const mode = shownMode(snapshot);
  return {
    label: "Graphics",
    detail: snapshot.lost
      ? "Not responding"
      : mode
        ? `${GRAPHICS_LABEL[mode]}${cardState(snapshot) ? ` · ${cardState(snapshot)}` : ""}`
        : cardState(snapshot) || "Graphics",
    on: !snapshot.lost && mode !== "integrated",
    lost: snapshot.lost !== null,
  };
}

export function useControlSnapshot(sources: SnapshotSources): ControlSnapshot {
  const devices = useDevices(sources.devices);
  const flags = useFlags(sources.flags);
  const { network, battery } = useSystem(sources.system);
  const bluetooth = useStore(sources.bluetooth);
  const machine = useStore<LaptopSnapshot>(sources.laptop?.store ?? null);
  const modes = useStore<ModeSnapshot>(sources.laptop?.modes ?? null);
  const graphics = useStore(sources.laptop?.graphics ?? null);
  const light = machine?.laptop ? keyboardLight(machine) : null;
  const limit = sources.chargeLimit?.() ?? null;
  const mirror = useMirror(sources.mirror);
  const playing = useStore(sources.media ?? null);
  return {
    wifi: devices.wifi,
    network: network ? (network.kind === "wifi" ? { kind: "wifi", ssid: network.ssid, bars: network.bars } : network) : null,
    bluetooth: devices.bluetooth,
    bluetoothDevice: bluetooth?.mine.find((device) => device.connected)?.name ?? null,
    brightness: devices.brightness,
    volume: devices.volume,
    dnd: flags.dnd,
    dark: flags.dark,
    night: flags.night,
    power: machine?.laptop && modes && modes.available.length > 0 ? { choice: modes.choice, mode: modes.effective?.mode ?? null } : null,
    light: light ? { ...light, name: lightLabel(light.level, light.max) } : null,
    graphics: graphicsTile(sources.laptop?.graphics, graphics),
    battery: battery ? { percent: battery.percent, charging: battery.state === "charging", limit, time: batteryTime(battery, limit) } : null,
    hotspot: devices.hotspot,
    mirroring: sources.mirror && mirror.screens >= 2 ? mirror.on : null,
    playing: nowPlaying(playing),
  };
}
