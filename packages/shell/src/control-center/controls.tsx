/**
 * What each tile does and how it is drawn, for the panel (panel.tsx) and
 * Settings › Control Center: Dashi's own controls from the machine's
 * snapshot (catalog.ts, snapshot.ts), applets' from their source
 * (applet-tiles.ts). One place decides what a press, Space, Return, and a
 * slider's drag do, so the pointer and the keyboard agree.
 */

import type { ReactNode } from "react";
import { useSyncExternalStore } from "react";
import { type AppletTile, type AppletTileSource, levelOf, nextChoice, valueAt } from "./applet-tiles.ts";
import { type ControlPage, type ControlSnapshot, controlInfo, isThere, lightToggle, powerToggle, SYSTEM_CONTROLS, tileState } from "./catalog.ts";
import type { AddEntry } from "./edit.tsx";
import { PUZZLE } from "./glyphs.ts";
import type { Layout, Placed, TileSize } from "./layout.ts";
import { type SnapshotSources, useControlSnapshot } from "./snapshot.ts";
import { BatteryRow, RoundTile, SliderTile, type TileLook, type TilePress, WideTile } from "./tiles.tsx";

/** The keyboard light's level before the knob turned it off, so on brings it back. */
let lastLight: number | null = null;

const EMPTY: readonly AppletTile[] = [];
const NO_APPLETS = { subscribe: () => () => {}, getSnapshot: () => EMPTY };

export interface ControlActions extends SnapshotSources {
  applets?: AppletTileSource;
  onLock: () => void;
  onBattery?: () => void;
}

export interface Controls {
  snapshot: ControlSnapshot;
  applet(id: string): AppletTile | undefined;
  sizesOf(id: string): readonly TileSize[];
  /** What Add lists: controls on this machine (and applets' declared ones) not in `layout`. */
  addable(layout: Layout): AddEntry[];
  isOn(id: string): boolean;
  /** How a tile is drawn now (its name, what it is set to, its glyph, on or off); null for one that isn't there. */
  lookOf(id: string): TileLook | null;
  /** A slider's level; null for anything else. */
  levelOf(id: string): number | null;
  setLevel(id: string, level: number): void;
  /** Space, or a press on a round tile: toggle, do, or (a page-only tile) open. */
  press(id: string, openPage: (page: ControlPage) => void): void;
  /** Return, or a wide tile's label: open its page (or the applet), else press. */
  open(id: string, openPage: (page: ControlPage) => void): void;
  render(tile: Placed, frame: { width: number; height: number }, editing: boolean, openPage: (page: ControlPage) => void): ReactNode;
}

export function useControls(actions: ControlActions): Controls {
  const snapshot = useControlSnapshot(actions);
  const source = actions.applets ?? NO_APPLETS;
  const appletTiles = useSyncExternalStore(source.subscribe, source.getSnapshot);
  const applet = (id: string): AppletTile | undefined => appletTiles.find((tile) => tile.key === id);

  const toggle = (id: string): void => {
    const { devices, flags, laptop } = actions;
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
        return actions.onLock();
    }
  };

  const appletPress = (tile: AppletTile): void => {
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
  };

  const press = (id: string, openPage: (page: ControlPage) => void): void => {
    const tile = applet(id);
    if (tile) return appletPress(tile);
    const info = controlInfo(id);
    if (!info) return;
    if (info.kind === "toggle" || info.kind === "button") return toggle(id);
    if (info.kind === "battery") return actions.onBattery?.();
    if (info.page) openPage(info.page);
  };

  const open = (id: string, openPage: (page: ControlPage) => void): void => {
    const tile = applet(id);
    if (tile) {
      // A choice's page lists its choices; it is the tile's own key.
      if (tile.kind === "choice") return openPage(tile.key as ControlPage);
      return actions.applets?.act(tile.key, tile.kind === "button" ? { kind: "press" } : { kind: "open" });
    }
    const info = controlInfo(id);
    if (info?.page) return openPage(info.page);
    press(id, openPage);
  };

  const levelOfControl = (id: string): number | null => {
    if (id === "brightness") return snapshot.brightness;
    if (id === "volume") return snapshot.volume ? (snapshot.volume.muted ? 0 : snapshot.volume.level) : null;
    const tile = applet(id);
    return tile?.kind === "slider" ? levelOf(tile) : null;
  };

  const setLevel = (id: string, level: number): void => {
    if (id === "brightness") return actions.devices.setBrightnessLevel(level);
    if (id === "volume") return actions.devices.setVolumeLevel(level);
    const tile = applet(id);
    if (tile?.kind === "slider") actions.applets?.act(id, { kind: "set", value: valueAt(tile, level) });
  };

  const look = (id: string): TileLook | null => {
    const tile = applet(id);
    if (tile) return { testID: `cc-${id}`, title: tile.title, detail: tile.detail, glyph: tile.glyph, on: tile.on, dim: !tile.running };
    const state = tileState(id, snapshot);
    return state ? { testID: `cc-${id}`, title: state.title, detail: state.detail, glyph: state.glyph, on: state.on } : null;
  };

  /** A wide tile's knob and label, a round tile's press. */
  const presses = (id: string, openPage: (page: ControlPage) => void): TilePress => {
    const tile = applet(id);
    if (tile) {
      if (tile.kind === "status") return { onOpen: () => open(id, openPage) };
      return { onToggle: () => press(id, openPage), onOpen: () => open(id, openPage) };
    }
    const info = controlInfo(id);
    if (!info || info.kind === "status") return {};
    const knob = info.kind === "toggle" || info.kind === "button" ? { onToggle: () => press(id, openPage) } : {};
    return { ...knob, ...(info.page ? { onOpen: () => openPage(info.page as ControlPage) } : {}) };
  };

  const render = (tile: Placed, frame: { width: number; height: number }, editing: boolean, openPage: (page: ControlPage) => void): ReactNode => {
    const shown = look(tile.id);
    if (!shown) return null;
    const handlers = editing ? {} : presses(tile.id, openPage);
    const level = levelOfControl(tile.id);
    if (level !== null && (tile.size === "tall" || tile.size === "flat")) {
      const appletTile = applet(tile.id);
      return (
        <SliderTile
          look={{
            testID: shown.testID,
            title: shown.title,
            glyph: shown.glyph,
            level,
            value: appletTile ? (shown.detail ?? String(appletTile.value ?? "")) : (shown.detail ?? ""),
            width: frame.width,
            height: frame.height,
          }}
          standing={tile.size === "tall"}
          onLevel={(next) => (editing ? undefined : setLevel(tile.id, next))}
        />
      );
    }
    if (tile.id === "battery" && snapshot.battery) {
      const battery = snapshot.battery;
      return (
        <BatteryRow
          look={{ percent: battery.percent, charging: battery.charging, limit: battery.limit, time: battery.time, glyph: shown.glyph }}
          onOpen={() => (editing ? undefined : actions.onBattery?.())}
        />
      );
    }
    return tile.size === "round" ? <RoundTile look={shown} {...handlers} /> : <WideTile look={shown} {...handlers} />;
  };

  return {
    snapshot,
    applet,
    sizesOf: (id) => applet(id)?.sizes ?? controlInfo(id)?.sizes ?? ["round"],
    addable: (layout) => {
      const placed = new Set(layout.map((item) => item.id));
      const own = SYSTEM_CONTROLS.filter((control) => !placed.has(control.id) && isThere(control.id, snapshot)).map(
        (control): AddEntry => ({ id: control.id, title: control.title, from: null, glyph: tileState(control.id, snapshot)?.glyph ?? PUZZLE }),
      );
      const theirs = appletTiles
        .filter((tile) => !placed.has(tile.key))
        .map((tile): AddEntry => ({ id: tile.key, title: tile.title, from: tile.appletName, glyph: tile.glyph }));
      return [...own, ...theirs];
    },
    isOn: (id) => look(id)?.on ?? false,
    lookOf: look,
    levelOf: levelOfControl,
    setLevel,
    press,
    open,
    render,
  };
}
