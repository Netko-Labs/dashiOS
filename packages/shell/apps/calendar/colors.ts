/** Calendar colors on the screen: the ink that reads on one, a see-through wash of it, and the same wash made solid on a ground. */

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

/** `color` at `alpha` (0 to 1) laid on `ground`, as one solid #RRGGBB: what `tint` shows there, but nothing under it shows through. */
export function over(color: string, alpha: number, ground: string): string {
  const parts = (hex: string): number[] => [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16) || 0);
  const [top, under] = [parts(color), parts(ground)];
  const a = Math.max(0, Math.min(1, alpha));
  return `#${top
    .map((value, index) =>
      Math.round(value * a + (under[index] ?? 0) * (1 - a))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}
