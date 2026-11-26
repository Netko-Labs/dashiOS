import { describe, expect, test } from "bun:test";
import { GLASS } from "@dashi/ui";
import { GlassSync, glassMode, glassStyle, withAlpha } from "../src/glass-style.ts";
import { settle } from "./support/time.ts";

const LIGHT = { dark: false, reduceTransparency: false, batterySaver: false, lighterOnSaver: true, tintGlass: true };

describe("glass-style: Frost's numbers, as the compositor takes them", () => {
  test("each level takes its blur, saturation, tint at its least α and solid twin, per mode", () => {
    const light = glassStyle(LIGHT);
    expect(light.levels.thin).toEqual({ blur: 18, saturation: 1.8, tint: withAlpha(GLASS.levels.thin.light.tint, 0.44), solid: GLASS.levels.thin.light.solid });
    expect(light.levels.regular.tint.endsWith("9E")).toBe(true);
    const dark = glassStyle({ ...LIGHT, dark: true });
    expect(dark.levels.thick.tint).toBe(withAlpha(GLASS.levels.thick.dark.tint, GLASS.levels.thick.dark.least));
    // The veil has no solid twin: where glass is solid the lock's wallpaper shows sharp.
    expect(light.levels.veil.solid).toBeUndefined();
    expect(dark.hairline.color).toBe(withAlpha("#000000", 0.5));
    expect(light.rim.top).toBe(withAlpha("#FFFFFF", 0.85));
    expect(light.floor.ratio).toBeCloseTo(4.65);
    // The floor's ink is the secondary vibrant ink: dark words in Light, light ones in Dark.
    expect(light.floor.ink < dark.floor.ink).toBe(true);
    expect(light.depth).toBe(2);
    expect(light.apps).toBe("regular");
  });

  test("Reduce Transparency is solid, battery saver the wallpaper only; Reduce Transparency wins", () => {
    const on = { lighterOnSaver: true };
    expect(glassMode({ ...on, reduceTransparency: false, batterySaver: false })).toBe("frosted");
    expect(glassMode({ ...on, reduceTransparency: false, batterySaver: true })).toBe("xray");
    expect(glassMode({ ...on, reduceTransparency: true, batterySaver: true })).toBe("solid");
  });

  test("Lighter glass on battery saver off keeps glass frosted on battery saver (GL-3, D729)", () => {
    expect(glassMode({ reduceTransparency: false, batterySaver: true, lighterOnSaver: false })).toBe("frosted");
    expect(glassStyle({ ...LIGHT, batterySaver: true, lighterOnSaver: false }).mode).toBe("frosted");
  });

  test("Tint glass with the wallpaper off: every level's saturation is 1, the rest unchanged (GL-4)", () => {
    const tinted = glassStyle(LIGHT);
    const gray = glassStyle({ ...LIGHT, tintGlass: false });
    for (const level of ["thin", "regular", "thick", "paper", "veil"] as const) {
      expect(gray.levels[level].saturation).toBe(1);
      expect(gray.levels[level].blur).toBe(tinted.levels[level].blur);
      expect(gray.levels[level].tint).toBe(tinted.levels[level].tint);
    }
    expect(tinted.levels.regular.saturation).toBe(GLASS.levels.regular.saturation);
  });

  test("α as two hex digits", () => {
    expect(withAlpha("#F6F6F8", 0.44)).toBe("#F6F6F870");
    expect(withAlpha("#F6F6F8", 2)).toBe("#F6F6F8FF");
    expect(withAlpha("#F6F6F8AA", 0)).toBe("#F6F6F800");
  });
});

describe("GlassSync", () => {
  const compositor = (frosted: boolean) => {
    const styles: unknown[] = [];
    const clients: unknown[] = [];
    return {
      styles,
      clients,
      glassStyle: async (params: unknown) => {
        styles.push(params);
        return { frosted };
      },
      glassClients: async (params: unknown) => {
        clients.push(params);
        return {};
      },
    };
  };

  test("nothing before Dark Mode is known, then each change once", async () => {
    const fake = compositor(true);
    const sync = new GlassSync(fake);
    sync.set({ reduceTransparency: false });
    expect(fake.styles).toHaveLength(0);
    sync.set({ dark: true });
    sync.set({ dark: true });
    expect(fake.styles).toHaveLength(1);
    sync.set({ batterySaver: true });
    expect(fake.styles).toMatchObject([{ mode: "frosted" }, { mode: "xray" }]);
    await settle();
    expect(sync.frosted).toBe(true);
  });

  test("a GPU that can't frost is known to the shell", async () => {
    const sync = new GlassSync(compositor(false));
    sync.set({ dark: false });
    await settle();
    expect(sync.frosted).toBe(false);
  });

  test("apps' glass is sent when it changes", () => {
    const fake = compositor(true);
    const sync = new GlassSync(fake);
    sync.setApps(true);
    sync.setApps(true);
    sync.setApps(false);
    expect(fake.clients).toEqual([
      { others: true, deny: [] },
      { others: false, deny: [] },
    ]);
  });
});
