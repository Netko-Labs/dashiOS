/**
 * How big things look on a screen nobody chose a scale for: a sharp laptop
 * panel or a 4K monitor shouldn't come up with everything tiny. The desktop
 * (the shell's displays.ts) and the login screen both pick it from the
 * screen's pixel density, so the login screen and the desktop after it match.
 */

/** A screen as these rules need it: its pixels as seen, and its size in millimeters (0 when unknown). */
export interface ScreenSize {
  name: string;
  width: number;
  height: number;
  widthMm: number;
  heightMm: number;
}

/** The scales offered, as on other desktops. */
export const SCALES = [1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const;

/** Pixels per inch that look right at scale 1: closer for a built-in panel, farther for a monitor. */
const COMFORTABLE_PPI = { builtIn: 125, monitor: 105 } as const;

/** A scaled screen keeps at least this much room (logical pixels). */
const MIN_LOGICAL = { width: 1200, height: 700 } as const;

/** Whether the screen is a laptop's own panel (eDP, LVDS, DSI connectors). */
export function isBuiltIn(name: string): boolean {
  return /^(eDP|LVDS|DSI)/i.test(name);
}

/** The scale a screen gets when nobody chose one. */
export function defaultScale(screen: ScreenSize): number {
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
