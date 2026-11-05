/**
 * WCAG contrast between two of the palette's colors, so the tokens can be
 * checked (test/contrast.test.ts) and docs/design.html can print the real
 * ratios. A translucent foreground is composited over its ground first, as
 * it is drawn.
 */

type Rgb = readonly [number, number, number];

/** "#rgb", "#rrggbb" or "#rrggbbaa" as 0–255 channels and an alpha 0–1; null for anything else. */
export function parseHex(color: string): { rgb: Rgb; alpha: number } | null {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(color);
  const digits = match?.[1];
  if (digits === undefined) return null;
  const full = digits.length === 3 ? [...digits].map((d) => d + d).join("") : digits;
  const channel = (at: number): number => Number.parseInt(full.slice(at, at + 2), 16);
  return { rgb: [channel(0), channel(2), channel(4)], alpha: full.length === 8 ? channel(6) / 255 : 1 };
}

function luminance([r, g, b]: Rgb): number {
  const linear = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** The contrast ratio (1–21) of `foreground` drawn on an opaque `ground`. */
export function contrastRatio(foreground: string, ground: string): number {
  const fg = parseHex(foreground);
  const bg = parseHex(ground);
  if (!fg || !bg) throw new Error(`not a color: ${fg ? ground : foreground}`);
  const mix = (i: 0 | 1 | 2): number => fg.rgb[i] * fg.alpha + bg.rgb[i] * (1 - fg.alpha);
  const a = luminance([mix(0), mix(1), mix(2)]);
  const b = luminance(bg.rgb);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
