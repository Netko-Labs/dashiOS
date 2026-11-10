/**
 * The monitors dashi-comp reports (IPC `outputs`): who they are, what they
 * run, what they could run. Includes the ones that are plugged in but turned
 * off, which `screensOf` (displays.ts) leaves out because they show
 * nothing. The identity of a monitor is its EDID (make, model, serial), so a
 * saved arrangement follows the monitor to another port; a monitor without
 * one is known by its connector.
 */

import { isBuiltIn } from "@dashi/ui";
import type { Frame, Output } from "../compositor/index.ts";

export type Rotation = 0 | 90 | 180 | 270;
export const ROTATIONS: readonly Rotation[] = [0, 90, 180, 270];

export interface Mode {
  width: number;
  height: number;
  /** Millihertz: 59940 is 59.94 Hz. */
  refreshMhz: number;
}

export interface OfferedMode extends Mode {
  /** The monitor's native mode. */
  preferred: boolean;
  current: boolean;
}

export interface Monitor {
  /** The connector's name, "eDP-1". */
  name: string;
  make: string;
  model: string;
  serial: string;
  builtIn: boolean;
  /** Turned on (false: plugged in but off, with no frame or mode). */
  enabled: boolean;
  /** Showing something now. */
  lit: boolean;
  primary: boolean;
  widthMm: number;
  heightMm: number;
  scale: number;
  /** Points, global; absent for a monitor that is off. */
  frame?: Frame;
  /** What it runs, in pixels as the panel is wired (not turned with the rotation). */
  mode?: Mode;
  modes: OfferedMode[];
  rotation: Rotation;
  flipped: boolean;
  /** Variable refresh rate: whether the screen can, whether it does now, and the person's choice. */
  vrr: MonitorVrr;
  /** The screen whose picture it shows (IPC `mirror`); absent while it shows its own desktop. It has no frame then. */
  mirrorOf?: string;
}

/** Variable refresh rate: off, on, or only while a window is full screen there. */
export type VrrMode = "off" | "on" | "fullscreen";
export const VRR_MODES: readonly VrrMode[] = ["off", "on", "fullscreen"];
export const isVrrMode = (value: unknown): value is VrrMode => VRR_MODES.some((mode) => mode === value);

export interface MonitorVrr {
  supported: boolean;
  active: boolean;
  mode: VrrMode;
}

const isRotation = (value: unknown): value is Rotation => ROTATIONS.some((rotation) => rotation === value);

const realMode = (mode: Mode | null): Mode | null => (mode && mode.width > 0 && mode.height > 0 ? mode : null);

/** The monitors among the screens (`outputs`, src/compositor/outputs.ts): one that is on but shows no mode is not one to work with. */
export function monitorsOf(outputs: readonly Output[]): Monitor[] {
  return outputs.flatMap((output): Monitor[] => {
    const mode = realMode(output.mode);
    if (output.enabled && !mode) return [];
    const modes = output.modes.flatMap((offered): OfferedMode[] => {
      const real = realMode(offered);
      return real ? [{ ...real, preferred: offered.preferred, current: offered.current }] : [];
    });
    const { rotation, flipped } = output.transform;
    return [
      {
        name: output.name,
        make: output.make,
        model: output.model,
        serial: output.serial,
        builtIn: isBuiltIn(output.name),
        enabled: output.enabled,
        lit: output.lit,
        primary: output.primary,
        widthMm: output.physicalMm.width,
        heightMm: output.physicalMm.height,
        scale: output.scale,
        ...(output.frame ? { frame: output.frame } : {}),
        ...(mode ? { mode: { width: mode.width, height: mode.height, refreshMhz: mode.refreshMhz } } : {}),
        modes,
        rotation: isRotation(rotation) ? rotation : 0,
        flipped,
        vrr: output.vrr,
        ...(output.mirrorOf ? { mirrorOf: output.mirrorOf } : {}),
      },
    ];
  });
}

/**
 * A monitor's identity across ports and sessions: its EDID make, model, and
 * serial. Two of the same model without serials differ by connector, and a
 * monitor that reports no make (a VM, a projector) is its connector.
 */
export function identityOf(monitor: Pick<Monitor, "name" | "make" | "model" | "serial">): string {
  const { name, make, model, serial } = monitor;
  if (make === "") return `port:${name}`;
  const base = `edid:${make}|${model}|${serial}`;
  return serial === "" ? `${base}|${name}` : base;
}

/** The key of a set of connected monitors: order does not matter. */
export function setKey(monitors: readonly Pick<Monitor, "name" | "make" | "model" | "serial">[]): string {
  return monitors.map(identityOf).sort().join("+");
}

/** "Dell U2720Q" or the connector when the monitor says nothing. */
export function monitorLabel(monitor: Pick<Monitor, "name" | "make" | "model" | "builtIn">): string {
  if (monitor.builtIn) return "Built-in Display";
  const model = monitor.model.trim();
  // Without an EDID the comp reports the connector as the model.
  if (monitor.make === "" || model === "" || model === monitor.name) return monitor.name;
  return model;
}

/** "2560 × 1440". */
export const sizeLabel = (mode: Pick<Mode, "width" | "height">): string => `${mode.width} × ${mode.height}`;

/** "59.94 Hz", "60 Hz". */
export function refreshLabel(refreshMhz: number): string {
  const hertz = Math.round(refreshMhz / 10) / 100;
  return `${Number.isInteger(hertz) ? hertz : hertz.toFixed(2)} Hz`;
}

/** The size the monitor shows, turned with its rotation: what it looks like to a person, in pixels. */
export function uprightSize(monitor: Pick<Monitor, "mode" | "rotation">): { width: number; height: number } | null {
  const mode = monitor.mode;
  if (!mode) return null;
  return monitor.rotation === 90 || monitor.rotation === 270 ? { width: mode.height, height: mode.width } : { width: mode.width, height: mode.height };
}

/** The distinct sizes among the modes offered, biggest first. */
export function sizesOf(modes: readonly Mode[]): Array<{ width: number; height: number }> {
  const seen = new Map<string, { width: number; height: number }>();
  for (const mode of modes) seen.set(`${mode.width}x${mode.height}`, { width: mode.width, height: mode.height });
  return [...seen.values()].sort((a, b) => b.width * b.height - a.width * a.height || b.width - a.width);
}

/**
 * The panel's native size: the mode its EDID prefers, as long as nothing it
 * offers is larger both ways (a panel can't show more pixels than it has).
 * A screen that prefers a smaller mode than it offers has no native size
 * Dashi can name (QEMU's monitor prefers 640 × 480 and offers up to
 * 5120 × 2160), so no choice is called native. A 4K screen that prefers
 * 3840 × 2160 and also takes the cinema 4096 × 2160 keeps its own.
 */
export function nativeSize(modes: readonly OfferedMode[]): { width: number; height: number } | null {
  const preferred = sizesOf(modes.filter((mode) => mode.preferred))[0];
  if (!preferred) return null;
  const larger = sizesOf(modes).some((size) => size.width > preferred.width && size.height > preferred.height);
  return larger ? null : preferred;
}

/**
 * The sizes worth offering first, largest first: the native one, the current
 * one, and up to `limit` others of the native shape (within 2%) that are no
 * larger than it. A monitor's EDID lists dozens, most of them odd shapes or
 * modes the panel only scales; "Show All Resolutions" has the rest.
 */
export function commonSizes(modes: readonly OfferedMode[], current: { width: number; height: number }, limit = 6): Array<{ width: number; height: number }> {
  const all = sizesOf(modes);
  // Without a native size, the size in use stands for the screen's shape and limit.
  const native = nativeSize(modes) ?? current;
  if (!native) return [];
  const shape = native.width / native.height;
  const same = (size: { width: number; height: number }) => size.width === current.width && size.height === current.height;
  const isNative = (size: { width: number; height: number }) => size.width === native.width && size.height === native.height;
  const fits = all.filter(
    (size) =>
      !isNative(size) &&
      !same(size) &&
      Math.abs(size.width / size.height - shape) / shape <= 0.02 &&
      size.width <= native.width &&
      size.height <= native.height,
  );
  const keep = new Set([...all.filter((size) => isNative(size) || same(size)), ...fits.slice(0, limit)]);
  return all.filter((size) => keep.has(size));
}

/** The rates a size is offered at, fastest first. */
export function ratesOf(modes: readonly Mode[], size: { width: number; height: number }): number[] {
  return modes
    .filter((mode) => mode.width === size.width && mode.height === size.height)
    .map((mode) => mode.refreshMhz)
    .sort((a, b) => b - a);
}

/** The mode of that size nearest `refreshMhz`, else the native one of that size, else the fastest. */
export function modeFor(modes: readonly OfferedMode[], size: { width: number; height: number }, refreshMhz?: number): OfferedMode | undefined {
  const same = modes.filter((mode) => mode.width === size.width && mode.height === size.height);
  if (refreshMhz !== undefined) {
    const near = [...same].sort((a, b) => Math.abs(a.refreshMhz - refreshMhz) - Math.abs(b.refreshMhz - refreshMhz))[0];
    if (near && Math.abs(near.refreshMhz - refreshMhz) <= 600) return near;
  }
  return same.find((mode) => mode.preferred) ?? [...same].sort((a, b) => b.refreshMhz - a.refreshMhz)[0];
}
