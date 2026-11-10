/**
 * What each tile does when it is pressed, opened, or slid, and how it is
 * drawn now (controls.tsx draws the tiles): Dashi's own controls from the
 * machine's snapshot (catalog.ts), applets' from their source
 * (applet-tiles.ts). One place decides what a press, Space, Return, and a
 * slider's drag do, so the pointer and the keyboard agree.
 */

import type { AppletTile, AppletTileSource } from "./applet-tiles.ts";
import { levelOf, nextChoice, valueAt } from "./applet-tiles.ts";
import { type ControlPage, type ControlSnapshot, controlInfo, lightToggle, powerToggle, tileState } from "./catalog.ts";
import type { SnapshotSources } from "./snapshot.ts";
import type { TileLook, TilePress } from "./tiles.tsx";

/** The keyboard light's level before the knob turned it off, so on brings it back. */
let lastLight: number | null = null;

export interface ControlActions extends SnapshotSources {
  applets?: AppletTileSource;
  onLock: () => void;
  onBattery?: () => void;
}

/** What the actions read: the actions themselves, the snapshot, and the applet tile by its key. */
export interface ControlScope {
  actions: ControlActions;
  snapshot: ControlSnapshot;
  applet(id: string): AppletTile | undefined;
}

function toggle(scope: ControlScope, id: string): void {
  const { devices, flags, laptop } = scope.actions;
  const { snapshot } = scope;
  switch (id) {
    case "wifi":
      return void devices.setWifi(snapshot.wifi !== true);
    case "bluetooth":
      return void devices.setBluetooth(snapshot.bluetooth !== true);
    case "focus":
      return flags.toggle("dnd");
    case "dark":
      return flags.toggle("dark");
    case "night":
      return flags.toggle("night");
    case "hotspot":
      return void devices.setHotspot(snapshot.hotspot !== true);
    case "mirror":
      return void scope.actions.mirror?.set(snapshot.mirroring !== true);
    case "power":
      if (snapshot.power) laptop?.modes.choose(powerToggle(snapshot.power));
      return;
    case "keyboard": {
      const light = snapshot.light;
      if (!light) return;
      if (light.level > 0) lastLight = light.level;
      laptop?.setLight(lightToggle(light, lastLight));
      return;
    }
    case "lock":
      return scope.actions.onLock();
  }
}

function appletPress(actions: ControlActions, tile: AppletTile): void {
  switch (tile.kind) {
    case "toggle":
      return actions.applets?.act(tile.key, { kind: "toggle", on: !tile.on });
    case "button":
      return actions.applets?.act(tile.key, { kind: "press" });
    case "choice": {
      const choice = nextChoice(tile);
      if (choice !== null) actions.applets?.act(tile.key, { kind: "choose", choice });
      return;
    }
    default:
      return actions.applets?.act(tile.key, { kind: "open" });
  }
}

/** Space, or a press on a round tile: toggle, do, or (a page-only tile) open. */
export function pressControl(scope: ControlScope, id: string, openPage: (page: ControlPage) => void): void {
  const tile = scope.applet(id);
  if (tile) return appletPress(scope.actions, tile);
  const info = controlInfo(id);
  if (!info) return;
  if (info.kind === "toggle" || info.kind === "button") return toggle(scope, id);
  if (info.kind === "battery") return scope.actions.onBattery?.();
  if (info.page) openPage(info.page);
}

/** Return, or a wide tile's label: open its page (or the applet), else press. */
export function openControl(scope: ControlScope, id: string, openPage: (page: ControlPage) => void): void {
  const tile = scope.applet(id);
  if (tile) {
    // A choice's page lists its choices; it is the tile's own key.
    if (tile.kind === "choice") return openPage(tile.key as ControlPage);
    return scope.actions.applets?.act(tile.key, tile.kind === "button" ? { kind: "press" } : { kind: "open" });
  }
  const info = controlInfo(id);
  if (info?.page) return openPage(info.page);
  pressControl(scope, id, openPage);
}

/** A slider's level; null for anything else. */
export function levelOfControl(scope: ControlScope, id: string): number | null {
  if (id === "brightness") return scope.snapshot.brightness;
  if (id === "volume") return scope.snapshot.volume ? (scope.snapshot.volume.muted ? 0 : scope.snapshot.volume.level) : null;
  const tile = scope.applet(id);
  return tile?.kind === "slider" ? levelOf(tile) : null;
}

export function setControlLevel(scope: ControlScope, id: string, level: number): void {
  if (id === "brightness") return scope.actions.devices.setBrightnessLevel(level);
  if (id === "volume") return scope.actions.devices.setVolumeLevel(level);
  const tile = scope.applet(id);
  if (tile?.kind === "slider") scope.actions.applets?.act(id, { kind: "set", value: valueAt(tile, level) });
}

/** How a tile is drawn now (its name, what it is set to, its glyph, on or off); null for one that isn't there. */
export function lookOf(scope: ControlScope, id: string): TileLook | null {
  const tile = scope.applet(id);
  if (tile) return { testID: `cc-${id}`, title: tile.title, detail: tile.detail, glyph: tile.glyph, on: tile.on, dim: !tile.running };
  const state = tileState(id, scope.snapshot);
  return state ? { testID: `cc-${id}`, title: state.title, detail: state.detail, glyph: state.glyph, on: state.on } : null;
}

/** A wide tile's knob and label, a round tile's press. */
export function presentationOf(scope: ControlScope, id: string, openPage: (page: ControlPage) => void): TilePress {
  const tile = scope.applet(id);
  if (tile) {
    if (tile.kind === "status") return { onOpen: () => openControl(scope, id, openPage) };
    return { onToggle: () => pressControl(scope, id, openPage), onOpen: () => openControl(scope, id, openPage) };
  }
  const info = controlInfo(id);
  if (!info || info.kind === "status") return {};
  const knob = info.kind === "toggle" || info.kind === "button" ? { onToggle: () => pressControl(scope, id, openPage) } : {};
  return { ...knob, ...(info.page ? { onOpen: () => openPage(info.page as ControlPage) } : {}) };
}
