/**
 * OKLCH and sRGB, the arithmetic the inks are made with (inks.ts): a colour
 * from lightness, chroma and hue, brought into the screen's gamut by lowering
 * chroma only (never hue or lightness), and the distance between two colours
 * in OKLab. Metal is handed the hex; nothing here runs per frame.
 */

export interface Oklch {
  /** Lightness, 0 to 1. */
  L: number;
  /** Chroma, 0 to about 0.37. */
  C: number;
  /** Hue in degrees. */
  H: number;
}

const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number): number => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** A `#rrggbb` colour in OKLab: [L, a, b]. */
export function hexToOklab(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1, 7), 16);
  const r = toLinear(((n >> 16) & 255) / 255);
  const g = toLinear(((n >> 8) & 255) / 255);
  const b = toLinear((n & 255) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** A `#rrggbb` colour in OKLCH. */
export function hexToOklch(hex: string): Oklch {
  const [L, A, B] = hexToOklab(hex);
  return { L, C: Math.hypot(A, B), H: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 };
}

function linearRgb(L: number, C: number, H: number): [number, number, number] {
  const a = C * Math.cos((H * Math.PI) / 180);
  const b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const outOfGamut = (rgb: readonly number[]): boolean => rgb.some((v) => v < -0.0005 || v > 1.0005);
const channel = (v: number): string =>
  Math.round(Math.min(1, Math.max(0, toGamma(Math.min(1, Math.max(0, v))))) * 255)
    .toString(16)
    .padStart(2, "0");

/** An OKLCH colour as `#RRGGBB`, its chroma lowered until the screen can show it. */
export function oklchToHex({ L, C, H }: Oklch): string {
  let c = C;
  let rgb = linearRgb(L, c, H);
  while (outOfGamut(rgb) && c > 0) {
    c = Math.max(0, c - 0.002);
    rgb = linearRgb(L, c, H);
  }
  return `#${rgb.map(channel).join("").toUpperCase()}`;
}

/** ΔE in OKLab (Euclidean): how far apart two colours look. */
export function deltaE(first: string, second: string): number {
  const a = hexToOklab(first);
  const b = hexToOklab(second);
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
