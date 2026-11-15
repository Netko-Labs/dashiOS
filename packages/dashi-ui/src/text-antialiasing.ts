/**
 * How Dashi's Metal hosts antialias text: by the panel's subpixels
 * (decisions.md D132; mirin's own default on Linux is grays). Every place
 * that spawns a host gives this as `NativeHostOptions.textAntialiasing`.
 * `MIRIN_METAL_TEXT` in the environment, when it names a mode, is someone's
 * own choice for the whole session and wins (a measurement in grays).
 */

export type TextAntialiasing = "subpixel" | "grayscale";

export function hostTextAntialiasing(env: Record<string, string | undefined> = process.env): TextAntialiasing {
  const asked = env.MIRIN_METAL_TEXT;
  return asked === "grayscale" || asked === "subpixel" ? asked : "subpixel";
}
