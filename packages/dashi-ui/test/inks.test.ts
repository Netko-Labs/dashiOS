import { describe, expect, test } from "bun:test";
import { contrastRatio, deltaE, hexToOklch, INK_NAMES, INK_PAPER, inkHex, inkTokens, ON_INK, tallyHex } from "../src/index.ts";

const MODES = ["light", "dark"] as const;
/** The job colours the inks must keep apart from (palette.ts). */
const JOBS = {
  light: { ume: "#AD3F55", broth: "#86600A", moss: "#38722C", microphone: "#B85A12", focus: "#6E56CF" },
  dark: { ume: "#E8798F", broth: "#E5B13F", moss: "#6CB45B", microphone: "#F0954A", focus: "#8B76E8" },
} as const;

describe("the inks' distance table (round five, frame 16)", () => {
  for (const mode of MODES) {
    test(`${mode}: every pair of inks stays apart (ΔE ≥ 0.075)`, () => {
      const inks = inkTokens(mode).ink;
      for (const [i, a] of INK_NAMES.entries())
        for (const b of INK_NAMES.slice(i + 1)) expect({ pair: `${a}/${b}`, far: deltaE(inks[a], inks[b]) >= 0.075 }).toEqual({ pair: `${a}/${b}`, far: true });
    });

    test(`${mode}: every hero ink passes 4.5:1 on its paper, and the flood's words pass on the ink`, () => {
      for (const name of INK_NAMES) {
        const ink = inkHex(name, mode);
        expect(contrastRatio(ink, INK_PAPER[mode])).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(ON_INK[mode], ink)).toBeGreaterThanOrEqual(4.5);
      }
    });

    test(`${mode}: no ink sits on a job colour (ΔE ≥ 0.06)`, () => {
      for (const name of INK_NAMES)
        for (const [job, hex] of Object.entries(JOBS[mode]))
          expect({ ink: name, job, far: deltaE(inkHex(name, mode), hex) >= 0.06 }).toEqual({ ink: name, job, far: true });
    });

    test(`${mode}: the tally is vermilion, chroma ≥ 0.18, apart from every ink`, () => {
      const tally = tallyHex(mode);
      const lch = hexToOklch(tally);
      expect(lch.C).toBeGreaterThanOrEqual(0.18);
      expect(lch.H).toBeGreaterThan(30);
      expect(lch.H).toBeLessThan(42);
      for (const name of INK_NAMES) expect(deltaE(tally, inkHex(name, mode))).toBeGreaterThanOrEqual(0.1);
    });
  }

  test("lightness steps: miso darkest, then mizu, matcha, the timer's wakame lightest, in both modes", () => {
    for (const mode of MODES) {
      const order = (["miso", "mizu", "matcha", "wakame"] as const).map((name) => hexToOklch(inkHex(name, mode)).L);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
    }
  });

  test("the timer is teal (the owner's call): hue 195–210, out of the amber range", () => {
    for (const mode of MODES) {
      const { H } = hexToOklch(inkHex("wakame", mode));
      expect(H).toBeGreaterThan(190);
      expect(H).toBeLessThan(212);
    }
  });

  test("house lights fall back: a dimmed ink is grey (chroma ≤ 0.03) and keeps its hue", () => {
    for (const mode of MODES)
      for (const name of INK_NAMES) {
        const lit = hexToOklch(inkHex(name, mode));
        const dim = hexToOklch(inkHex(name, mode, { dim: true }));
        expect(dim.C).toBeLessThanOrEqual(0.03);
        expect(dim.C).toBeLessThan(lit.C);
      }
  });

  test("tokens are computed once per mode and carry the dimmed twins", () => {
    const a = inkTokens("dark");
    expect(inkTokens("dark")).toBe(a);
    expect(a.dimmed.mizu).not.toBe(a.ink.mizu);
    expect(a.tallyWash.startsWith(a.tally)).toBe(true);
  });
});
