/**
 * What each tile does and how it is drawn, for the panel (panel.tsx) and
 * Settings › Control Center: the tiles, from the machine's snapshot and
 * applets' sources. The decisions are control-actions.ts's, so the pointer
 * and the keyboard agree; this file draws what they act on.
 */

import type { ReactNode } from "react";
import { useSyncExternalStore } from "react";
import type { AppletTile } from "./applet-tiles.ts";
import { type ControlPage, type ControlSnapshot, controlInfo, isThere, SYSTEM_CONTROLS, tileState } from "./catalog.ts";
import {
  type ControlActions,
  type ControlScope,
  levelOfControl,
  lookOf,
  openControl,
  presentationOf,
  pressControl,
  setControlLevel,
} from "./control-actions.ts";
import type { AddEntry } from "./edit.tsx";
import { PUZZLE } from "./glyphs.ts";
import type { Layout, Placed, TileSize } from "./layout.ts";
import { useControlSnapshot } from "./snapshot.ts";
import { BatteryRow, RoundTile, SliderTile, type TileLook, WideTile } from "./tiles.tsx";

export type { ControlActions } from "./control-actions.ts";

const EMPTY: readonly AppletTile[] = [];
const NO_APPLETS = { subscribe: () => () => {}, getSnapshot: () => EMPTY };

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

/** A tile as the panel draws it: a slider, the battery row, or a round or wide tile with its presses. */
function renderTile(
  scope: ControlScope,
  tile: Placed,
  frame: { width: number; height: number },
  editing: boolean,
  openPage: (page: ControlPage) => void,
): ReactNode {
  const shown = lookOf(scope, tile.id);
  if (!shown) return null;
  const handlers = editing ? {} : presentationOf(scope, tile.id, openPage);
  const level = levelOfControl(scope, tile.id);
  if (level !== null && (tile.size === "tall" || tile.size === "flat")) {
    const appletTile = scope.applet(tile.id);
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
        onLevel={(next) => (editing ? undefined : setControlLevel(scope, tile.id, next))}
      />
    );
  }
  const { snapshot, actions } = scope;
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
}

export function useControls(actions: ControlActions): Controls {
  const snapshot = useControlSnapshot(actions);
  const source = actions.applets ?? NO_APPLETS;
  const appletTiles = useSyncExternalStore(source.subscribe, source.getSnapshot);
  const applet = (id: string): AppletTile | undefined => appletTiles.find((tile) => tile.key === id);
  const scope: ControlScope = { actions, snapshot, applet };

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
    isOn: (id) => lookOf(scope, id)?.on ?? false,
    lookOf: (id) => lookOf(scope, id),
    levelOf: (id) => levelOfControl(scope, id),
    setLevel: (id, level) => setControlLevel(scope, id, level),
    press: (id, openPage) => pressControl(scope, id, openPage),
    open: (id, openPage) => openControl(scope, id, openPage),
    render: (tile, frame, editing, openPage) => renderTile(scope, tile, frame, editing, openPage),
  };
}
