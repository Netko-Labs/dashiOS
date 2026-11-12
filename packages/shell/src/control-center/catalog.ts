/**
 * Every control Control Center can show, and what each one looks like now
 * (docs/design.html, "Control Center"). Pure: the snapshot of the machine
 * comes in (the radios, the switches, the power mode, the keyboard light, the
 * battery), each tile's state goes out, and a tile for something the machine
 * lacks is not there at all. Applets' controls are the same shape
 * (applet-controls.ts) under ids `applet:<applet id>/<control id>`.
 */

import { ETHERNET, SUN, speakerGlyph, wifiGlyph } from "../glyphs.ts";
import { graphicsGlyph, keyboardLightGlyph, modeGlyph } from "../laptop/glyphs.ts";
import { MODE_LABEL, MODE_SHORT, type Mode, type ModeChoice } from "../power/modes/types.ts";
import type { Bars } from "../system/network.ts";
import { BATTERY, BLUETOOTH, BOLT, CONTRAST, HOTSPOT, MIRROR, MOON, PADLOCK, SUNSET } from "./glyphs.ts";
import type { Layout, TileSize } from "./layout.ts";

/**
 * What pressing does: a toggle's knob (or a round tile) switches it, a button
 * does its one thing, a page only opens, a slider is dragged, and the battery
 * row opens the battery panel.
 */
export type ControlKind = "toggle" | "button" | "page" | "slider" | "battery" | "status";

/** The laptop tiles' pages (laptop-pages.tsx). */
export type LaptopPage = "laptop-mode" | "laptop-light" | "graphics";

/** The pages a tile opens (panel.tsx draws them). */
export type ControlPageId = "wifi" | "bluetooth" | "sound" | LaptopPage;

/** What the panel shows: the grid, or a tile's page (an applet's choice control's page is its tile's key). */
export type ControlPage = "main" | ControlPageId | `applet:${string}`;

export interface ControlInfo {
  id: string;
  title: string;
  kind: ControlKind;
  /** The sizes it comes in, the first being the one it is added in. */
  sizes: readonly TileSize[];
  page?: ControlPageId;
}

export const SYSTEM_CONTROLS: readonly ControlInfo[] = [
  { id: "wifi", title: "Wi-Fi", kind: "toggle", sizes: ["wide", "round"], page: "wifi" },
  { id: "ethernet", title: "Ethernet", kind: "status", sizes: ["wide", "round"] },
  { id: "bluetooth", title: "Bluetooth", kind: "toggle", sizes: ["wide", "round"], page: "bluetooth" },
  { id: "brightness", title: "Display", kind: "slider", sizes: ["tall", "flat"] },
  { id: "volume", title: "Sound", kind: "slider", sizes: ["tall", "flat"], page: "sound" },
  { id: "focus", title: "Focus", kind: "toggle", sizes: ["round", "wide"] },
  { id: "dark", title: "Dark", kind: "toggle", sizes: ["round", "wide"] },
  { id: "power", title: "Power", kind: "toggle", sizes: ["wide", "round"], page: "laptop-mode" },
  { id: "keyboard", title: "Keyboard", kind: "toggle", sizes: ["wide", "round"], page: "laptop-light" },
  { id: "battery", title: "Battery", kind: "battery", sizes: ["flat"] },
  { id: "lock", title: "Lock", kind: "button", sizes: ["round", "wide"] },
  { id: "night", title: "Night Shift", kind: "toggle", sizes: ["round", "wide"] },
  { id: "graphics", title: "Graphics", kind: "page", sizes: ["wide", "round"], page: "graphics" },
  { id: "hotspot", title: "Hotspot", kind: "toggle", sizes: ["round", "wide"] },
  { id: "mirror", title: "Mirroring", kind: "toggle", sizes: ["round", "wide"] },
];

/**
 * What a new machine shows (the approved design): Wi-Fi (Ethernet on a
 * machine without it), the two sliders, Bluetooth, Focus, Dark, Power,
 * Keyboard light and the battery. The rest waits in Add.
 */
export const DEFAULT_LAYOUT: Layout = [
  { id: "wifi", size: "wide" },
  { id: "ethernet", size: "wide" },
  { id: "brightness", size: "tall" },
  { id: "volume", size: "tall" },
  { id: "bluetooth", size: "wide" },
  { id: "focus", size: "round" },
  { id: "dark", size: "round" },
  { id: "power", size: "wide" },
  { id: "keyboard", size: "wide" },
  { id: "battery", size: "flat" },
];

/** The machine as Control Center sees it; null is "not on this machine". */
export interface ControlSnapshot {
  /** The Wi-Fi radio; null without Wi-Fi hardware. */
  wifi: boolean | null;
  /** The network the machine is on. */
  network: { kind: "offline" } | { kind: "wired" } | { kind: "wifi"; ssid: string; bars: Bars } | null;
  bluetooth: boolean | null;
  /** The first connected Bluetooth device's name. */
  bluetoothDevice: string | null;
  brightness: number | null;
  volume: { level: number; muted: boolean } | null;
  dnd: boolean;
  dark: boolean;
  night: boolean;
  /** The power modes; null without any. */
  power: { choice: ModeChoice; mode: Mode | null } | null;
  /** The keyboard light; null without one. */
  light: { level: number; max: number; name: string } | null;
  /** The graphics card's tile; null on a machine with one GPU. */
  graphics: { label: string; detail: string; on: boolean; lost: boolean } | null;
  battery: { percent: number; charging: boolean; limit: number | null; time: string | null } | null;
  /** Personal Hotspot; null without Wi-Fi to share. */
  hotspot: boolean | null;
  /** The other screens show the built-in one (display-config/mirror.ts); null with one screen. */
  mirroring: boolean | null;
}

/** What a tile shows. */
export interface TileState {
  title: string;
  /** The second line of a wide tile; the word under a round one is the title. */
  detail: string | null;
  glyph: string;
  on: boolean;
}

/** Whether the control is on this machine now. */
export function isThere(id: string, snap: ControlSnapshot): boolean {
  switch (id) {
    case "wifi":
      return snap.wifi !== null;
    case "ethernet":
      return snap.wifi === null && snap.network?.kind === "wired";
    case "bluetooth":
      return snap.bluetooth !== null;
    case "brightness":
      return snap.brightness !== null;
    case "volume":
      return snap.volume !== null;
    case "focus":
    case "dark":
    case "night":
    case "lock":
      return true;
    case "power":
      return snap.power !== null;
    case "keyboard":
      return snap.light !== null;
    case "battery":
      return snap.battery !== null;
    case "graphics":
      return snap.graphics !== null;
    case "hotspot":
      return snap.hotspot !== null;
    case "mirror":
      return snap.mirroring !== null;
    default:
      return false;
  }
}

export const controlInfo = (id: string): ControlInfo | undefined => SYSTEM_CONTROLS.find((control) => control.id === id);

const onOff = (on: boolean): string => (on ? "On" : "Off");

/** A system control's tile now; null for an id that isn't one (or isn't there). */
export function tileState(id: string, snap: ControlSnapshot): TileState | null {
  if (!isThere(id, snap)) return null;
  const title = controlInfo(id)?.title ?? id;
  switch (id) {
    case "wifi": {
      const on = snap.wifi === true;
      const ssid = snap.network?.kind === "wifi" ? snap.network.ssid : null;
      const bars = snap.network?.kind === "wifi" ? snap.network.bars : 3;
      return { title, detail: on ? (ssid ?? "Not Connected") : "Off", glyph: wifiGlyph(on ? bars : "offline"), on };
    }
    case "ethernet":
      return { title, detail: "Connected", glyph: ETHERNET, on: true };
    case "bluetooth": {
      const on = snap.bluetooth === true;
      return { title, detail: on ? (snap.bluetoothDevice ?? "On") : "Off", glyph: BLUETOOTH, on };
    }
    case "brightness":
      return { title, detail: percentText(snap.brightness ?? 0), glyph: SUN, on: false };
    case "volume": {
      const volume = snap.volume ?? { level: 0, muted: true };
      return { title, detail: volume.muted ? "Muted" : percentText(volume.level), glyph: speakerGlyph(volume.level, volume.muted), on: false };
    }
    case "focus":
      return { title, detail: onOff(snap.dnd), glyph: MOON, on: snap.dnd };
    case "dark":
      return { title, detail: onOff(snap.dark), glyph: CONTRAST, on: snap.dark };
    case "night":
      return { title, detail: onOff(snap.night), glyph: SUNSET, on: snap.night };
    case "lock":
      return { title, detail: "Lock Screen", glyph: PADLOCK, on: false };
    case "power": {
      const power = snap.power;
      if (!power) return null;
      const automatic = power.choice === "automatic";
      const mode = power.mode ?? (power.choice === "automatic" ? null : power.choice);
      // On is Automatic choosing; the knob holds the mode it chose, or gives the choice back to Automatic.
      const detail = automatic ? (mode ? `Auto · ${MODE_SHORT[mode]}` : "Automatic") : mode ? MODE_LABEL[mode] : "Power mode";
      return {
        title,
        detail,
        glyph: modeGlyph(mode ?? "balanced"),
        on: automatic,
      };
    }
    case "keyboard": {
      const light = snap.light;
      if (!light) return null;
      return { title, detail: light.name, glyph: keyboardLightGlyph(light.level > 0), on: light.level > 0 };
    }
    case "graphics": {
      const graphics = snap.graphics;
      if (!graphics) return null;
      return { title, detail: graphics.detail, glyph: graphicsGlyph(graphics.lost), on: graphics.on };
    }
    case "battery": {
      const battery = snap.battery;
      if (!battery) return null;
      return { title, detail: battery.time, glyph: battery.charging ? BOLT : BATTERY, on: false };
    }
    case "hotspot":
      return { title, detail: onOff(snap.hotspot === true), glyph: HOTSPOT, on: snap.hotspot === true };
    case "mirror":
      return { title, detail: onOff(snap.mirroring === true), glyph: MIRROR, on: snap.mirroring === true };
    default:
      return null;
  }
}

/** "68%". */
export const percentText = (level: number): string => `${Math.round(Math.min(Math.max(level, 0), 1) * 100)}%`;

/**
 * The keyboard light's knob: off goes back to the level it had (the lowest
 * when it never had one), on goes off.
 */
export function lightToggle(light: { level: number; max: number }, remembered: number | null): number {
  if (light.level > 0) return 0;
  return Math.min(Math.max(remembered ?? 1, 1), light.max);
}

/** The power tile's knob: off Automatic holds the mode in effect; on it gives the choice back to Automatic. */
export function powerToggle(power: { choice: ModeChoice; mode: Mode | null }): ModeChoice {
  if (power.choice !== "automatic") return "automatic";
  return power.mode ?? "balanced";
}
