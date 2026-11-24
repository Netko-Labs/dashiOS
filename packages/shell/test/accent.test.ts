import { describe, expect, test } from "bun:test";
import { controlPalette, DARK_CONTROLS, drawAccent, KOMBU_SEED, LIGHT_CONTROLS } from "@dashi/ui";
import { AccentSync, pixelsCommand, type ReadPixels } from "../src/appearance/index.ts";
import { parseSettings } from "../src/settings/settings.ts";
import { gtk4Colors, gtkColors } from "../src/shared/appearance/gtk-colors.ts";
import { accentFill, nearestAccent } from "../src/shared/appearance/index.ts";
import { FlagsStore, parseFlags } from "../src/shared/control-center/index.ts";

/** A still that is all one colour. */
const solid = (r: number, g: number, b: number): Uint8Array => Uint8Array.from({ length: 96 * 60 * 3 }, (_, i) => [r, g, b][i % 3] ?? 0);

function sync(pixels: ReadPixels) {
  const flags = new FlagsStore(null);
  const reads: string[] = [];
  const accent = new AccentSync({
    flags,
    pixels: async (still) => {
      reads.push(JSON.stringify(still));
      return pixels(still);
    },
  });
  return { flags, reads, accent };
}

describe("the accent's setting", () => {
  test("settings.json keeps a preset, a colour or the wallpaper; anything else is a problem and Kombu", () => {
    expect(parseSettings({ appearance: { accent: { preset: "momo" } } }).settings.appearance.accent).toEqual({ preset: "momo" });
    expect(parseSettings({ appearance: { accent: { custom: "#E0508F" } } }).settings.appearance.accent).toEqual({ custom: "#E0508F" });
    expect(parseSettings({ appearance: { accent: { wallpaper: true } } }).settings.appearance.accent).toEqual({ wallpaper: true });
    const bad = parseSettings({ appearance: { accent: { preset: "purple" } } });
    expect(bad.settings.appearance.accent).toBeUndefined();
    expect(bad.problems.join()).toContain("appearance.accent");
  });

  test("a preset's seed goes into Control Center's file; Kombu is no key", async () => {
    const { flags, accent } = sync(async () => null);
    await accent.apply({ preset: "ai" }, { mode: "fill" });
    expect(flags.getSnapshot().accent).toBe("#036DB0");
    await accent.apply(undefined, { mode: "fill" });
    expect("accent" in flags.getSnapshot()).toBe(false);
    await accent.apply({ preset: "kombu" }, { mode: "fill" });
    expect(flags.getSnapshot().accent).toBeUndefined();
  });

  test("From wallpaper reads the wallpaper once, and again only when it changes", async () => {
    const { flags, reads, accent } = sync(async () => solid(108, 63, 188));
    await accent.apply({ wallpaper: true }, { path: "dusk", mode: "fill" });
    await accent.apply({ wallpaper: true }, { path: "dusk", mode: "fit" });
    expect(reads.length).toBe(1);
    expect(reads[0]).toContain("dusk.thumb.png");
    expect(flags.getSnapshot().accent).toBeDefined();
    await accent.apply({ wallpaper: true }, { path: "midnight", mode: "fill" });
    expect(reads.length).toBe(2);
  });

  test("a wallpaper with no colour keeps Kombu", async () => {
    const { flags, accent } = sync(async () => solid(128, 128, 128));
    await accent.apply({ wallpaper: true }, { path: "/home/alexk/Pictures/grey.png", mode: "fill" });
    expect(flags.getSnapshot().accent).toBeUndefined();
  });

  test("the still is read with ImageMagick, a video's first frame with FFmpeg", () => {
    expect(pixelsCommand({ image: "/a.jpg" })).toEqual(["magick", "/a.jpg[0]", "-resize", "96x60!", "-depth", "8", "rgb:-"]);
    expect(pixelsCommand({ video: "/a.mp4" })[0]).toBe("ffmpeg");
  });

  test("Control Center's file keeps the seed; a bad one is none", () => {
    expect(parseFlags('{"dark":true,"accent":"#da4482"}')).toEqual({ dnd: false, dark: true, night: false, accent: "#DA4482" });
    expect(parseFlags('{"accent":"pink"}')).toEqual({ dnd: false, dark: false, night: false });
  });
});

describe("what the accent reaches", () => {
  test("Kombu keeps every control and GTK colour as it was", () => {
    expect(controlPalette(false, KOMBU_SEED)).toBe(LIGHT_CONTROLS);
    expect(controlPalette(true, null)).toBe(DARK_CONTROLS);
    expect(gtkColors(false).accent_bg_color).toBe("#357A64");
    expect(gtkColors(true).accent_fg_color).toBe("#ffffff");
    expect(accentFill(null)).toBe("#357A64");
    expect(nearestAccent(accentFill(null))).toBe("green");
  });

  test("another accent is exact in GTK, per mode, with readable words on it", () => {
    const lime = "#B5E32A";
    expect(gtkColors(false, lime).accent_bg_color).toBe(drawAccent(lime, false).fill);
    expect(gtkColors(true, lime).accent_bg_color).toBe(lime);
    expect(gtkColors(false, lime).accent_fg_color).toBe("#111113");
    const css = gtk4Colors(12, lime);
    expect(css).toContain(`--accent-bg-color: ${drawAccent(lime, false).fill};`);
    expect(css).toContain("--accent-fg-color: #111113;");
    expect(nearestAccent(accentFill("#DA4482"))).toBe("pink");
  });

  test("Control Center's on tile takes the accent and its words", () => {
    const momo = controlPalette(false, "#DA4482");
    expect(momo.on).toBe("#DA4482");
    expect(momo.onInk).toBe("#111113");
    expect(momo.surface).toBe(LIGHT_CONTROLS.surface);
  });
});
