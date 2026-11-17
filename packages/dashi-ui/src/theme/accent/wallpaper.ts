/**
 * From wallpaper: the picture's most colourful common hue, as a seed the
 * guard then draws like any pick. The shell hands over a small downscale
 * (96 × 60 or so, packed RGB); each pixel votes for its hue in 10° bins,
 * weighted by its chroma squared, so a wide quiet sky loses to a band of
 * colour; greys and near-blacks don't vote. The winning bin's pixels give
 * the seed their weighted lightness, chroma and hue.
 */

import { hexToOklch, oklchToHex } from "./lib/oklch.ts";

const BINS = 36;
/** Below this a pixel is grey, and below `DARK` lightness near black: neither votes. */
const GREY = 0.03;
const DARK = 0.22;

const hex2 = (n: number): string => n.toString(16).padStart(2, "0");

/** The seed of `rgb` (3 bytes a pixel); null for a picture with no colour to speak of. */
export function seedFromPixels(rgb: Uint8Array): string | null {
  const weight = new Float64Array(BINS);
  const sums = Array.from({ length: BINS }, () => ({ L: 0, C: 0, x: 0, y: 0 }));
  for (let at = 0; at + 2 < rgb.length; at += 3) {
    const { L, C, H } = hexToOklch(`#${hex2(rgb[at] ?? 0)}${hex2(rgb[at + 1] ?? 0)}${hex2(rgb[at + 2] ?? 0)}`);
    if (C < GREY || L < DARK) continue;
    const bin = Math.floor(H / (360 / BINS)) % BINS;
    const sum = sums[bin];
    if (!sum) continue;
    // Chroma squared: a band of colour outvotes a wide, quiet sky.
    const w = C * C;
    weight[bin] = (weight[bin] ?? 0) + w;
    sum.L += L * w;
    sum.C += C * w;
    sum.x += Math.cos((H * Math.PI) / 180) * w;
    sum.y += Math.sin((H * Math.PI) / 180) * w;
  }
  let best = -1;
  for (let bin = 0; bin < BINS; bin++) if ((weight[bin] ?? 0) > (weight[best] ?? 0)) best = bin;
  const w = weight[best] ?? 0;
  const sum = sums[best];
  if (!sum || w <= 0) return null;
  const H = ((Math.atan2(sum.y, sum.x) * 180) / Math.PI + 360) % 360;
  return oklchToHex({ L: sum.L / w, C: sum.C / w, H });
}
