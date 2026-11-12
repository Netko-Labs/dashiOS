import type { Monitor, OfferedMode } from "../../src/display-config/monitors.ts";

export const offered = (width: number, height: number, refreshMhz: number, preferred = false): OfferedMode => ({
  width,
  height,
  refreshMhz,
  preferred,
  current: false,
});

/** The G14's panel: 2880 × 1800 at 120 and 60, and a smaller size at 144. */
const G14_MODES = [offered(2880, 1800, 120_000, true), offered(2880, 1800, 60_000), offered(1920, 1200, 144_000), offered(1920, 1200, 60_000)];

export function panel(refreshMhz: number, overrides: Partial<Monitor> = {}): Monitor {
  return {
    name: "eDP-1",
    make: "",
    model: "",
    serial: "",
    builtIn: true,
    enabled: true,
    lit: true,
    primary: true,
    widthMm: 300,
    heightMm: 190,
    scale: 1.75,
    mode: { width: 2880, height: 1800, refreshMhz },
    modes: G14_MODES,
    rotation: 0,
    flipped: false,
    vrr: { supported: false, active: false, mode: "off" },
    ...overrides,
  };
}
