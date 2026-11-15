/**
 * How Dashi's Metal hosts antialias text: in grays, which is what Dashi
 * supports (decisions.md D142, which corrects D132). Subpixel is the
 * person's to opt in to: `MIRIN_METAL_TEXT=subpixel` in the session's
 * environment, applied here as every host is spawned
 * (`NativeHostOptions.textAntialiasing`). An opted-in host draws subpixel
 * text in windows, and on a layer or lock surface only where the surface is
 * declared opaque (mirin's rule: subpixel text must know what is behind it).
 */

export type TextAntialiasing = "subpixel" | "grayscale";

export function hostTextAntialiasing(env: Record<string, string | undefined> = process.env): TextAntialiasing {
  const asked = env.MIRIN_METAL_TEXT;
  return asked === "grayscale" || asked === "subpixel" ? asked : "grayscale";
}
