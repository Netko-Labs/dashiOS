// H21b, every measure is a token (scripts/check-design-measures.ts): what counts as a literal measure.
import { describe, expect, test } from "bun:test";
import { STEPS } from "../check.ts";
import { rawMeasures } from "../check-design-measures.ts";

const raw = (file: string, text: string): string[] => rawMeasures([file], () => text).map((hit) => `${hit.category}:${hit.value}`);
const APP = "packages/shell/apps/notes/lib/view.tsx";
const KIT = "packages/dashi-ui/src/chip.tsx";

describe("H21b measures are tokens", () => {
  test("a literal size, line, spacing, radius, opacity, weight or shadow in a style counts", () => {
    const text = 'const s = { fontSize: 12, lineHeight: 16, padding: 8, gap: 6, borderRadius: 7, opacity: 0.4, fontWeight: "semibold", shadow: "xl" };';
    expect(raw(APP, text)).toEqual(["fontSize:12", "lineHeight:16", "spacing:8", "spacing:6", "radius:7", "opacity:0.4", "weight:semibold", "shadow:xl"]);
  });
  test("tokens, arithmetic on a name, and a negated token don't", () => {
    const text = [
      "const a = { fontSize: TYPE.body.size, padding: SPACE.m, borderRadius: pill(HEIGHT), opacity: OPACITY.half };",
      "const b = { marginTop: -SPACE.xs, marginLeft: -RING_ROOM, borderRadius: KNOB / 2, fontWeight: WEIGHT.bold, shadow: SHADOW.sm };",
    ].join("\n");
    expect(raw(APP, text)).toEqual([]);
  });
  test('0, "auto", a percentage and a 1 px hairline\'s offset are no measure', () => {
    expect(raw(APP, 'const s = { margin: 0, marginLeft: "auto", paddingTop: "10%", marginTop: -1, gap: 1, opacity: 1 };')).toEqual([]);
  });
  test("a literal added to a token still counts; so does each side of a choice", () => {
    expect(raw(APP, "const s = { paddingTop: SPACE.m + 3, gap: big ? 10 : SPACE.m };")).toEqual(["spacing:3", "spacing:10"]);
  });
  test("timers are named constants of their module, not style measures", () => {
    expect(raw(APP, "setTimeout(go, 300);\nconst o = { delayMs: 200, fadeDuration: 150 };")).toEqual([]);
  });
  test("a named constant beside its component is fine in the kit, a literal elsewhere", () => {
    const table = "const MENU = { padding: 5 } as const;\nconst PAD = 9;\nconst s = { gap: PAD };";
    expect(raw(KIT, table)).toEqual([]);
    expect(raw(APP, table)).toEqual(["spacing:5", "spacing:9"]);
    // A lower-case name, or one inside a function, is no named constant.
    expect(raw(KIT, "const pad = 9;\nconst s = { gap: pad };")).toEqual(["spacing:9"]);
    expect(raw(KIT, "function Row() { const PAD = 9; return { gap: PAD }; }")).toEqual(["spacing:9"]);
    // A SCREAMING_CASE function is no table of measures.
    expect(raw(KIT, "const ROW = () => ({ padding: 12 });")).toEqual(["spacing:12"]);
  });
  test("bun run check runs it, in the fast set", () => {
    const fast = STEPS.filter((step) => step.fast).map((step) => step.command.join(" "));
    expect(fast).toContain("bun scripts/check-design-measures.ts");
  });
});
