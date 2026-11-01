/** Calendar colors on the screen: the ink that reads on one, and a see-through wash of it. */

/** 0 (black) to 1 (white), by the usual weights of red, green, and blue. */
export function luminance(color: string): number {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(color);
  if (!match) return 0;
  const [r, g, b] = [match[1], match[2], match[3]].map((part) => Number.parseInt(part ?? "0", 16) / 255) as [number, number, number];
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Ink for text on `color`: dark on a light color (yellow), white otherwise. */
export const inkOn = (color: string): string => (luminance(color) > 0.68 ? "#1d1d1f" : "#ffffff");

/** `color` at `alpha` (0 to 1) as #RRGGBBAA. */
export function tint(color: string, alpha: number): string {
  const byte = Math.max(0, Math.min(255, Math.round(alpha * 255)));
  return `${color.slice(0, 7)}${byte.toString(16).padStart(2, "0")}`;
}
