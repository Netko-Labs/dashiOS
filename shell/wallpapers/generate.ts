/**
 * Renders Dashi's bundled wallpapers: `bun shell/wallpapers/generate.ts`
 * (optionally with the names to redo). Everything is drawn from the formulas
 * below (no source images), so the output is the same every time. Each
 * wallpaper becomes `<name>.png` at 3840x2160 and a `<name>.thumb.png` at
 * 320x180 for System Settings' grid. A 2x2 ordered dither (a fixed pattern,
 * so deflate still finds it; a larger one would not fit the size budget of
 * about 1.5 MB per file) hides banding in the gradients.
 *
 * `dusk` is the compositor's built-in gradient, the same arithmetic as the
 * WALLPAPER shader in comp/src/shaders.rs; keep the two in step.
 */

import { join } from "node:path";
import { encodePng } from "./png.ts";

type Color = readonly [number, number, number];
/** A color for the point (u, v) in 0..1, v growing downwards; channels 0..1. */
type Painter = (u: number, v: number) => Color;

const mix = (a: Color, b: Color, t: number): Color => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const add = (a: Color, b: Color, k: number): Color => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const smooth = (t: number): number => t * t * (3 - 2 * t);
/** A soft round (or oval) light centered on (cx, cy) in a 16:9 frame; `r` is its reach in heights. */
const glow = (u: number, v: number, cx: number, cy: number, r: number, stretch = 1): number => {
  const dx = ((u - cx) * (16 / 9)) / stretch;
  const dy = v - cy;
  return Math.exp(-(dx * dx + dy * dy) / (r * r));
};

const dusk: Painter = (u, v) => {
  const night: Color = [0.09, 0.086, 0.247];
  const mid: Color = [0.42, 0.243, 0.769];
  const broth: Color = [0.973, 0.635, 0.18];
  const t = Math.min(Math.max(u * 0.45 + v * 0.75, 0), 1.2) / 1.2;
  const base = t < 0.55 ? mix(night, mid, t / 0.55) : mix(mid, broth, (t - 0.55) / 0.45);
  // The shader's glow is exp(-5 d) in uv units, not a Gaussian.
  const d = Math.hypot(u - 0.78, v - 0.92);
  return add(base, [0.3, 0.16, 0.02], Math.exp(-5 * d));
};

const midnight: Painter = (u, v) => {
  const top: Color = [0.035, 0.04, 0.09];
  const bottom: Color = [0.012, 0.014, 0.03];
  let c = mix(top, bottom, smooth(v));
  c = add(c, [0.09, 0.1, 0.32], 0.55 * glow(u, v, 0.28, 0.2, 0.42));
  c = add(c, [0.16, 0.07, 0.3], 0.4 * glow(u, v, 0.82, 0.78, 0.38));
  return add(c, [0.02, 0.12, 0.16], 0.3 * glow(u, v, 0.6, 0.35, 0.22, 1.6));
};

const dawn: Painter = (u, v) => {
  const sky: Color = [0.72, 0.8, 0.95];
  const blush: Color = [0.99, 0.82, 0.8];
  const gold: Color = [1, 0.9, 0.72];
  let c = mix(sky, blush, smooth(Math.min(Math.max(v * 0.9 + (1 - u) * 0.25, 0), 1)));
  c = mix(c, gold, 0.85 * glow(u, v, 0.2, 1.02, 0.55, 1.5));
  c = add(c, [0.1, 0.04, 0.08], 0.35 * glow(u, v, 0.85, 0.2, 0.3));
  return c;
};

const mist: Painter = (u, v) => {
  const a: Color = [0.9, 0.93, 0.96];
  const b: Color = [0.8, 0.85, 0.92];
  let c = mix(a, b, smooth(Math.min(Math.max(u * 0.35 + v * 0.65, 0), 1)));
  c = mix(c, [0.97, 0.98, 1], 0.7 * glow(u, v, 0.3, 0.22, 0.36, 1.3));
  c = mix(c, [0.7, 0.78, 0.9], 0.45 * glow(u, v, 0.88, 0.85, 0.34, 1.2));
  return c;
};

const aurora: Painter = (u, v) => {
  // Soft ribbons of green, teal, and violet over a deep blue-black sky.
  let c = mix([0.02, 0.035, 0.07], [0.03, 0.05, 0.1], smooth(v));
  const ribbon = (centre: number, wave: number, spread: number): number => {
    const y = centre + wave * Math.sin(u * 5.2 + centre * 9) + 0.04 * Math.sin(u * 11.3 + centre * 3);
    const d = (v - y) / spread;
    return Math.exp(-d * d) * (0.35 + 0.65 * smooth(Math.sin(u * Math.PI)));
  };
  c = add(c, [0.1, 0.8, 0.5], 0.55 * ribbon(0.42, 0.07, 0.11));
  c = add(c, [0.1, 0.55, 0.75], 0.4 * ribbon(0.55, 0.06, 0.14));
  c = add(c, [0.5, 0.25, 0.85], 0.4 * ribbon(0.68, 0.05, 0.16));
  return add(c, [0.05, 0.08, 0.2], 0.4 * glow(u, v, 0.5, 1.1, 0.6, 2));
};

export const WALLPAPERS: Readonly<Record<string, Painter>> = { dusk, midnight, dawn, mist, aurora };

const BAYER = [0, 2, 3, 1];

export function render(paint: Painter, width: number, height: number): Uint8Array {
  const rgb = new Uint8Array(width * height * 3);
  let at = 0;
  for (let y = 0; y < height; y++) {
    const v = (y + 0.5) / height;
    for (let x = 0; x < width; x++) {
      const color = paint((x + 0.5) / width, v);
      const threshold = ((BAYER[(y & 1) * 2 + (x & 1)] as number) + 0.5) / 4;
      for (let channel = 0; channel < 3; channel++) {
        rgb[at++] = Math.min(255, Math.max(0, Math.floor((color[channel] as number) * 255 + threshold)));
      }
    }
  }
  return rgb;
}

if (import.meta.main) {
  const dir = import.meta.dir;
  const wanted = process.argv.slice(2);
  for (const [name, paint] of Object.entries(WALLPAPERS)) {
    if (wanted.length > 0 && !wanted.includes(name)) continue;
    for (const [suffix, width, height] of [["", 3840, 2160], [".thumb", 320, 180]] as const) {
      const png = encodePng(width, height, render(paint, width, height));
      await Bun.write(join(dir, `${name}${suffix}.png`), png);
      console.log(`${name}${suffix}.png ${width}x${height} ${(png.length / 1024).toFixed(0)} KiB`);
    }
  }
}
