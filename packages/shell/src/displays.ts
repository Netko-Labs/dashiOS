/**
 * Each screen's scale when nobody chose one: a sharp laptop panel or a 4K
 * monitor shouldn't come up with everything tiny. Bun picks it from the
 * screen's pixel density and asks dashi-comp (IPC `output {name, scale}`)
 * once per screen, the first time that screen is seen in this session.
 * A screen that reports no physical size (a projector, a VM) stays at 1.
 *
 * A scale the person chose in System Settings (settings.json `displays`) wins
 * over the computed one; `saved` says which, by screen name.
 */

import { type Compositor, type Frame, parseFrame } from "./compositor.ts";

export interface ScreenInfo {
  name: string;
  /** Pixels, the current mode as it looks (a screen turned on its side is taller than wide). */
  width: number;
  height: number;
  /** Millimeters; 0 when the screen doesn't say. */
  widthMm: number;
  heightMm: number;
  scale: number;
  /** Where the screen sits and how big it is in points (pixels over scale); absent if the compositor did not say. */
  frame?: Frame;
}

/** The scales offered, as on other desktops. */
export const SCALES = [1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const;

/** Pixels per inch that look right at scale 1: closer for a built-in panel, farther for a monitor. */
const COMFORTABLE_PPI = { builtIn: 125, monitor: 105 } as const;

/** A scaled screen keeps at least this much room (logical pixels). */
const MIN_LOGICAL = { width: 1200, height: 700 } as const;

/**
 * The least room (points) a scale someone else picks may leave. Below it the
 * shell's own sheets (the consent sheet is 500 wide) and the Dock stop
 * fitting, and with no settings window yet there is no way back.
 */
const MIN_USABLE = { width: 800, height: 500 } as const;

/**
 * Whether the screen keeps enough room at `scale` for the shell to be usable.
 * Scale 1 always does: no screen is smaller than its own pixels, and it is
 * the way back from any other.
 */
export function leavesRoom(screen: Pick<ScreenInfo, "width" | "height">, scale: number): boolean {
  return scale <= 1 || (screen.width / scale >= MIN_USABLE.width && screen.height / scale >= MIN_USABLE.height);
}

/** The offered scales this screen can take. */
export function scalesFor(screen: Pick<ScreenInfo, "width" | "height">): number[] {
  return SCALES.filter((scale) => leavesRoom(screen, scale));
}

/** Whether the screen is a laptop's own panel (eDP, LVDS, DSI connectors). */
export function isBuiltIn(name: string): boolean {
  return /^(eDP|LVDS|DSI)/i.test(name);
}

/** The scale a screen gets when nobody chose one. */
export function defaultScale(screen: ScreenInfo): number {
  const { width, height, widthMm, heightMm } = screen;
  // Sizes under 5 cm are made up (EDID placeholders); trust neither.
  if (widthMm < 50 || heightMm < 50 || width <= 0 || height <= 0) return 1;
  const ppi = Math.hypot(width, height) / (Math.hypot(widthMm, heightMm) / 25.4);
  const wanted = ppi / (isBuiltIn(screen.name) ? COMFORTABLE_PPI.builtIn : COMFORTABLE_PPI.monitor);
  const roomy = SCALES.filter((scale) => width / scale >= MIN_LOGICAL.width && height / scale >= MIN_LOGICAL.height);
  // The closest offered scale to what the density wants, never below 1 and
  // never so large the screen gets cramped.
  return roomy.reduce<number>((best, scale) => (Math.abs(scale - wanted) < Math.abs(best - wanted) ? scale : best), 1);
}

/** The screens in an IPC `outputs` answer; malformed entries are skipped. */
export function parseScreens(answer: unknown): ScreenInfo[] {
  const outputs = typeof answer === "object" && answer !== null ? (answer as { outputs?: unknown }).outputs : undefined;
  if (!Array.isArray(outputs)) return [];
  const number = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
  return outputs.flatMap((output: unknown): ScreenInfo[] => {
    if (typeof output !== "object" || output === null) return [];
    const { name, mode, physicalMm, scale, transform, enabled } = output as Record<string, unknown>;
    // A monitor that is plugged in but off shows nothing: not a screen.
    if (enabled === false) return [];
    const pixels = typeof mode === "object" && mode !== null ? (mode as Record<string, unknown>) : {};
    const size = typeof physicalMm === "object" && physicalMm !== null ? (physicalMm as Record<string, unknown>) : {};
    const width = number(pixels.width);
    const height = number(pixels.height);
    const current = number(scale);
    if (typeof name !== "string" || width === null || height === null || current === null) return [];
    const frame = parseFrame((output as Record<string, unknown>).frame);
    // A screen on its side is as tall as it is wide: sizes are as a person sees them.
    const turn = typeof transform === "object" && transform !== null ? (transform as Record<string, unknown>).rotation : 0;
    const sideways = turn === 90 || turn === 270;
    const [seenWidth, seenHeight] = sideways ? [height, width] : [width, height];
    const [seenWidthMm, seenHeightMm] = sideways ? [number(size.height) ?? 0, number(size.width) ?? 0] : [number(size.width) ?? 0, number(size.height) ?? 0];
    return [{ name, width: seenWidth, height: seenHeight, widthMm: seenWidthMm, heightMm: seenHeightMm, scale: current, ...(frame ? { frame } : {}) }];
  });
}

/**
 * The scale a screen comes up with: the one the person chose, else the
 * default for its density. A saved scale goes through the same room check as
 * a chosen one: settings.json is a file anyone can edit, and a screen that
 * was swapped for a smaller one must not come up too big to use.
 */
export function initialScale(screen: ScreenInfo, saved: (name: string) => number | undefined): number {
  const chosen = saved(screen.name);
  return chosen !== undefined && leavesRoom(screen, chosen) ? chosen : defaultScale(screen);
}

/**
 * Give each newly seen screen its saved or default scale, now and whenever
 * screens change. Returns a stop function.
 */
export function startDisplays(
  compositor: Pick<Compositor, "request" | "on">,
  saved: (name: string) => number | undefined = () => undefined,
): () => void {
  const seen = new Set<string>();
  const apply = async () => {
    const screens = parseScreens(await compositor.request("outputs"));
    for (const screen of screens) {
      if (seen.has(screen.name)) continue;
      seen.add(screen.name);
      const scale = initialScale(screen, saved);
      if (scale === screen.scale) continue;
      await compositor.request("output", { name: screen.name, scale });
      console.log(`dashi-shell: ${screen.name} at scale ${scale}`);
    }
  };
  const run = () => void apply().catch((error) => console.error("dashi-shell: could not scale the screens:", error));
  run();
  return compositor.on((event) => {
    if (event.event === "outputs-changed") run();
  });
}
