import { describe, expect, test } from "bun:test";
import { ACCENT_PRESETS, accentSentence, drawAccent, isAccentChoice, KOMBU_SEED, seedFromPixels, seedOf } from "../src/theme/accent/index.ts";
import { derive, FIXED, GROUNDS, hueGap, INK, type Mode, minContrast, RULE, steps } from "../src/theme/accent/lib/guard.ts";
import { contrast, deltaE, hexToOklch, over } from "../src/theme/accent/lib/oklch.ts";

// The themes spec's B3, as the accent's design measured it (dashi-0.9.0-design/accent/src/check.js):
// any seed, in either mode, with and without Increase contrast, keeps fills at 3:1 (4.5:1) on every
// window ground, words at 4.5:1 (7:1), words on a fill AA, the page's ink AA on both washes, and stays
// apart from the tally, the microphone and the agents' purple.

/** A seeded generator, so a failure names a seed that fails again. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEEDS = 2000;

const opaque = (wash: string, ground: string): string => over(wash.slice(0, 7), Number.parseInt(wash.slice(7), 16) / 255, ground);

function failures(seed: string, mode: Mode, hc: boolean): string[] {
  const drawn = derive(seed, mode, { hc });
  const edge = hc ? RULE.edgeHC : RULE.edge;
  const text = hc ? RULE.textHC : RULE.text;
  const out: string[] = [];
  if (minContrast(drawn.fill, GROUNDS[mode]) < edge - 0.01) out.push(`fill ${drawn.fill} under ${edge}:1`);
  if (minContrast(drawn.ink, GROUNDS[mode]) < text - 0.01) out.push(`ink ${drawn.ink} under ${text}:1`);
  if (contrast(drawn.on, drawn.fill) < text - 0.01) out.push(`words ${drawn.on} on ${drawn.fill}`);
  for (const step of steps(drawn.fill, drawn.on, hc)) if (contrast(drawn.on, step) < text - 0.01) out.push(`words on step ${step}`);
  for (const wash of [drawn.wash, drawn.text]) {
    for (const ground of GROUNDS[mode]) if (contrast(INK[mode], opaque(wash, ground)) < text - 0.01) out.push(`ink on wash ${wash} over ${ground}`);
  }
  if (!hc) {
    if (deltaE(drawn.fill, FIXED.tally[mode]) < RULE.apart - 0.002) out.push(`fill ${drawn.fill} near the tally`);
    if (deltaE(drawn.fill, FIXED.microphone[mode]) < RULE.apart - 0.002) out.push(`fill ${drawn.fill} near the microphone`);
  }
  const moved = hexToOklch(drawn.seed);
  if (moved.C >= RULE.loud && hueGap(moved.H, hexToOklch(FIXED.shiso.light).H) < RULE.agentGap - 0.5) out.push(`seed ${drawn.seed} near shiso`);
  return out.map((what) => `${seed} ${mode}${hc ? " hc" : ""}: ${what}`);
}

describe("the guard holds for any seed", () => {
  for (const mode of ["light", "dark"] as const) {
    for (const hc of [false, true]) {
      test(`${SEEDS} random seeds, ${mode}${hc ? ", Increase contrast" : ""}`, () => {
        const next = random(mode === "light" ? (hc ? 3 : 1) : hc ? 4 : 2);
        const failed: string[] = [];
        for (let i = 0; i < SEEDS; i++) {
          const seed = `#${Math.floor(next() * 0x1000000)
            .toString(16)
            .padStart(6, "0")}`;
          failed.push(...failures(seed, mode, hc));
        }
        expect(failed).toEqual([]);
      });
    }
  }
});

describe("the presets and the drawn picks", () => {
  test("every preset draws as the design's table says", () => {
    expect(drawAccent("#036DB0", false).fill).toBe("#036DB0");
    expect(drawAccent("#DA4482", true).on).toBe("#111113");
    expect(drawAccent("#9BD12E", false).fill).toBe("#6D9804");
    expect(drawAccent("#2B2B2E", true).fill).toBe("#636366");
    expect(drawAccent("#B5E32A", false).fill).toBe("#779901");
    expect(drawAccent("#F26B1D", false).fill).toBe("#B2806A");
    expect(drawAccent("#F26B1D", true).fill).toBe("#BF8C76");
    expect(drawAccent("#7A4FE0", false).fill).toBe("#B132AB");
  });

  test("the sheet's one line says why a pick moved", () => {
    expect(accentSentence("#F26B1D", false)).toBe("Orange is kept for the tally and the microphone, so yours is drawn quieter.");
    expect(accentSentence("#7A4FE0", false)).toBe("Purple is the agents' and the keyboard's, so yours is moved toward pink.");
    expect(accentSentence("#B5E32A", false)).toBe("Drawn deeper on Light so words and switches stay readable.");
    expect(accentSentence("#B5E32A", true)).toBe("");
    expect(accentSentence("#2B2B2E", true)).toBe("Drawn lighter on Dark so words and switches stay readable.");
    expect(accentSentence(KOMBU_SEED, false)).toBe("");
  });

  test("no preset sits in a guarded band", () => {
    for (const preset of ACCENT_PRESETS) for (const dark of [false, true]) expect(drawAccent(preset.seed, dark).moved).not.toContain("signal");
  });

  test("a choice names its seed; anything else is no choice", () => {
    expect(seedOf(undefined)).toBe(KOMBU_SEED);
    expect(seedOf({ preset: "momo" })).toBe("#DA4482");
    expect(seedOf({ custom: "#e0508f" })).toBe("#E0508F");
    expect(seedOf({ wallpaper: true }, "#6C3FBC")).toBe("#6C3FBC");
    expect(seedOf({ wallpaper: true })).toBe(KOMBU_SEED);
    expect(isAccentChoice({ preset: "momo" })).toBe(true);
    expect(isAccentChoice({ preset: "purple" })).toBe(false);
    expect(isAccentChoice({ custom: "#12345" })).toBe(false);
    expect(isAccentChoice({ wallpaper: false })).toBe(false);
    expect(isAccentChoice({ preset: "ai", custom: "#000000" })).toBe(false);
  });
});

describe("From wallpaper", () => {
  const picture = (parts: Array<[number, [number, number, number]]>): Uint8Array =>
    Uint8Array.from(parts.flatMap(([count, rgb]) => Array.from({ length: count }, () => rgb).flat()));

  test("a band of colour outvotes a wide, quiet sky", () => {
    const seed = seedFromPixels(
      picture([
        [4000, [70, 80, 110]],
        [600, [200, 40, 150]],
      ]),
    );
    expect(seed).not.toBeNull();
    expect(Math.abs(hexToOklch(seed ?? "#000000").H - hexToOklch("#C82896").H)).toBeLessThan(6);
  });

  test("greys and near-blacks give no seed", () => {
    expect(
      seedFromPixels(
        picture([
          [3000, [128, 128, 128]],
          [3000, [10, 12, 30]],
        ]),
      ),
    ).toBeNull();
  });
});
