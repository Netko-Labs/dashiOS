/**
 * Deciding what to ask the compositor for (IPC `outputs-config`), pure so it
 * can be tested: the configuration to restore for a set of monitors (a saved
 * arrangement, the lid, a default scale), the one that undoes a change, and
 * the layout to save from what the compositor reports. The compositor is the
 * mechanism (it keeps screens apart and touching); everything chosen is here.
 */

import type { Params } from "../compositor/index.ts";
import { choosePrimary } from "../menubar/menubars.ts";
import { type Box, settle } from "./layout.ts";
import { defaultMode, identityOf, type Mode, type Monitor, modeFor, type Rotation, type VrrMode } from "./monitors.ts";
import type { SavedLayout, SavedMonitor } from "./saved.ts";

/** What one monitor should be; a field left out is left alone. Names are the compositor's connectors. */
export interface MonitorConfig {
  name: string;
  enabled?: boolean;
  /** Points: where its top-left sits (the compositor keeps screens apart and touching). */
  position?: { x: number; y: number };
  mode?: Mode;
  rotation?: Rotation;
  flipped?: boolean;
  scale?: number;
  vrr?: VrrMode;
}

export interface ConfigRequest {
  outputs: MonitorConfig[];
  /** The connector of the main display. */
  primary?: string;
}

/** The scale a monitor gets running `mode` turned by `rotation`: the person's saved one if it fits, else the default. */
export type ScaleFor = (monitor: Monitor, mode: Mode, rotation: Rotation) => number;

export interface RestoreOptions {
  /** The lid is shut: the built-in panel goes dark when another monitor is there to use. */
  lidClosed: boolean;
  scaleFor: ScaleFor;
  /** The mode the monitor last ran in any saved arrangement: what it runs in a set that has none for it. */
  lastMode?: (monitor: Monitor) => Mode | undefined;
  /** A monitor nobody chose a mode for runs `defaultMode` (default true; false after the screens refused it). */
  defaultModes?: boolean;
}

const sameMode = (a: Mode | undefined, b: Mode | undefined): boolean =>
  a !== undefined && b !== undefined && a.width === b.width && a.height === b.height && Math.abs(a.refreshMhz - b.refreshMhz) <= 600;

/**
 * The configuration for these monitors: where a saved arrangement had each,
 * with a default scale, the lid applied; only what differs from now. Null
 * when everything already is as wanted.
 */
export function planRestore(all: readonly Monitor[], saved: SavedLayout | undefined, options: RestoreOptions): ConfigRequest | null {
  // A monitor that mirrors another is left as it is: moving it would end its mirroring (mirror.ts).
  const monitors = all.filter((monitor) => monitor.mirrorOf === undefined);
  const wanted = (monitor: Monitor): SavedMonitor | undefined => saved?.monitors[identityOf(monitor)];
  // On by the arrangement (a monitor nobody saved is on).
  const onBySaved = (monitor: Monitor): boolean => wanted(monitor)?.enabled ?? true;
  const others = monitors.filter((monitor) => !monitor.builtIn && onBySaved(monitor));
  const darkByLid = (monitor: Monitor): boolean => options.lidClosed && monitor.builtIn && others.length > 0;
  const on = (monitor: Monitor): boolean => onBySaved(monitor) && !darkByLid(monitor);
  // Never plan every screen off.
  const lit = monitors.filter(on);
  const outputs: MonitorConfig[] = [];
  for (const monitor of monitors) {
    const entry = wanted(monitor);
    const enable = lit.length === 0 ? true : on(monitor);
    const config: MonitorConfig = { name: monitor.name };
    if (enable !== monitor.enabled) config.enabled = enable;
    if (enable) {
      const rotation = entry?.rotation ?? monitor.rotation;
      const flipped = entry?.flipped ?? monitor.flipped;
      const mode = wantedMode(monitor, entry, options);
      if (mode && !sameMode(mode, monitor.mode)) config.mode = { width: mode.width, height: mode.height, refreshMhz: mode.refreshMhz };
      if (rotation !== monitor.rotation || flipped !== monitor.flipped) {
        config.rotation = rotation;
        config.flipped = flipped;
      }
      if (mode) {
        const scale = options.scaleFor(monitor, mode, rotation);
        if (Math.abs(scale - monitor.scale) > 0.005) config.scale = scale;
      }
      if (entry && (entry.x !== monitor.frame?.x || entry.y !== monitor.frame?.y)) config.position = { x: entry.x, y: entry.y };
    }
    if (Object.keys(config).length > 1) outputs.push(config);
  }
  const names = lit.length > 0 ? lit.map((monitor) => monitor.name) : monitors.map((monitor) => monitor.name);
  const savedPrimary = saved?.primary ? monitors.find((monitor) => identityOf(monitor) === saved.primary && names.includes(monitor.name)) : undefined;
  const primary = savedPrimary?.name ?? choosePrimary(names) ?? undefined;
  const current = monitors.find((monitor) => monitor.primary)?.name;
  const request: ConfigRequest = { outputs, ...(primary !== undefined && primary !== current ? { primary } : {}) };
  return request.outputs.length === 0 && request.primary === undefined ? null : request;
}

/** The mode a monitor should run: the set's saved one, else the one it last ran anywhere, else its default (D552), else what it runs. */
function wantedMode(monitor: Monitor, entry: SavedMonitor | undefined, options: RestoreOptions): Mode | undefined {
  const asked = entry?.mode ?? options.lastMode?.(monitor);
  const offered = asked && modeFor(monitor.modes, asked, asked.refreshMhz);
  if (offered) return offered;
  return (options.defaultModes !== false && !entry?.mode ? defaultMode(monitor.modes) : undefined) ?? monitor.mode;
}

/** The request that puts every monitor back exactly as it is now. */
export function configOf(monitors: readonly Monitor[]): ConfigRequest {
  // One that mirrors is left mirroring: turning it on or moving it would end that.
  const outputs = monitors
    .filter((monitor) => monitor.mirrorOf === undefined)
    .map((monitor): MonitorConfig => {
      if (!monitor.enabled || !monitor.mode) return { name: monitor.name, enabled: false };
      return {
        name: monitor.name,
        enabled: true,
        ...(monitor.frame ? { position: { x: monitor.frame.x, y: monitor.frame.y } } : {}),
        mode: monitor.mode,
        rotation: monitor.rotation,
        flipped: monitor.flipped,
        scale: monitor.scale,
      };
    });
  const primary = monitors.find((monitor) => monitor.primary && monitor.enabled)?.name;
  return { outputs, ...(primary !== undefined ? { primary } : {}) };
}

/**
 * The layout to save from what the compositor reports. A built-in panel the
 * lid turned off keeps what was saved for it (its place comes back when the
 * lid opens), and so does any monitor that is off.
 */
export function layoutOf(monitors: readonly Monitor[], previous: SavedLayout | undefined, lidClosed: boolean): SavedLayout {
  const kept: Record<string, SavedMonitor> = {};
  for (const monitor of monitors) {
    const identity = identityOf(monitor);
    const before = previous?.monitors[identity];
    const byLid = lidClosed && monitor.builtIn && !monitor.enabled;
    // Mirroring is for now: its place on the desk is kept for when it stops.
    if (monitor.mirrorOf !== undefined) {
      if (before) kept[identity] = before;
    } else if (monitor.enabled && monitor.mode && monitor.frame) {
      kept[identity] = {
        enabled: true,
        x: monitor.frame.x,
        y: monitor.frame.y,
        mode: monitor.mode,
        rotation: monitor.rotation,
        flipped: monitor.flipped,
      };
    } else if (byLid) {
      kept[identity] = before ?? { enabled: true, x: 0, y: 0, rotation: 0, flipped: false };
    } else {
      kept[identity] = { ...(before ?? { x: 0, y: 0, rotation: 0, flipped: false }), enabled: false };
    }
  }
  const main = monitors.find((monitor) => monitor.primary && monitor.enabled);
  // With the lid shut the main display is the monitor only for now: the panel's place as main is kept.
  const lidDark = lidClosed && monitors.some((monitor) => monitor.builtIn && !monitor.enabled);
  const before = previous?.primary && previous.primary in kept ? previous.primary : null;
  const primary = lidDark && before ? before : main ? identityOf(main) : before;
  return { primary, monitors: kept };
}

/** Where a monitor sits and how big it is in points once `config` is made, or null when it will show no desktop of its own. */
function boxAfter(monitor: Monitor, config: MonitorConfig | undefined): Box | null {
  const mode = config?.mode ?? monitor.mode;
  if (!(config?.enabled ?? monitor.enabled) || monitor.mirrorOf !== undefined || !mode) return null;
  const rotation = config?.rotation ?? monitor.rotation;
  const scale = config?.scale ?? monitor.scale;
  const [width, height] = rotation === 90 || rotation === 270 ? [mode.height, mode.width] : [mode.width, mode.height];
  // The compositor rounds a screen's size in points up (smithay's `output_geometry`).
  const at = config?.position ?? (monitor.frame ? { x: monitor.frame.x, y: monitor.frame.y } : { x: Number.MAX_SAFE_INTEGER / 4, y: 0 });
  return { name: monitor.name, x: at.x, y: at.y, width: Math.ceil(width / scale - 1e-6), height: Math.ceil(height / scale - 1e-6) };
}

/**
 * `request` with the positions that keep the screens apart and touching
 * once it is made (layout.ts `settle`, D553): a screen that grows pushes its
 * neighbour along, one that shrinks pulls it in. The main display stays put.
 */
export function settled(request: ConfigRequest, monitors: readonly Monitor[]): ConfigRequest {
  const configs = new Map(request.outputs.map((config) => [config.name, config]));
  const boxes = monitors.flatMap((monitor) => boxAfter(monitor, configs.get(monitor.name)) ?? []);
  const anchor = request.primary ?? monitors.find((monitor) => monitor.primary)?.name;
  const outputs = [...request.outputs];
  for (const box of settle(boxes, anchor)) {
    const monitor = monitors.find((each) => each.name === box.name);
    const config = configs.get(box.name);
    const now = config?.position ?? (monitor?.frame ? { x: monitor.frame.x, y: monitor.frame.y } : null);
    if (now && now.x === box.x && now.y === box.y) continue;
    const position = { x: box.x, y: box.y };
    if (config) outputs[outputs.indexOf(config)] = { ...config, position };
    else outputs.push({ name: box.name, position });
  }
  return { ...request, outputs };
}

/** The wire form of a request: what `outputs-config` takes. */
export function toWire(request: ConfigRequest): Params<"outputs-config"> {
  return {
    outputs: request.outputs.map((config) => ({
      name: config.name,
      ...(config.enabled !== undefined ? { enabled: config.enabled } : {}),
      ...(config.position ? { position: config.position } : {}),
      ...(config.mode ? { mode: { width: config.mode.width, height: config.mode.height, refreshMhz: config.mode.refreshMhz } } : {}),
      ...(config.rotation !== undefined || config.flipped !== undefined
        ? { transform: { rotation: config.rotation ?? 0, flipped: config.flipped ?? false } }
        : {}),
      ...(config.scale !== undefined ? { scale: config.scale } : {}),
      ...(config.vrr !== undefined ? { vrr: config.vrr } : {}),
    })),
    ...(request.primary !== undefined ? { primary: request.primary } : {}),
  };
}
