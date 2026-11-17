/**
 * The Inks on mirin PR #55's host: Inter Display at the value's weight, rows
 * and the album print through `<Dots>`, the breathing "Now" tag, Reduce
 * Motion to every host; and today's look on a host that does not say so.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { inkTokens } from "@dashi/ui";
import { type NativeEvent, type NativeTransport, render } from "@mirinjs/metal";
import { DotRow } from "../src/shared/inks/index.ts";
import { HostRegistry, hostAbilities, NO_ABILITIES } from "../src/shared/metal/index.ts";
import { Card, NowTag, Num, previewSizes, SIZE_ORDER, widgetInfo } from "../src/widgets/index.ts";
import { tagOnEdge } from "../src/widgets/layout.ts";
import { numberFace, numberWeight } from "../src/widgets/lib/numerals.ts";
import { ART_GRID, halftoneLayers, stockPrint } from "../src/widgets/lib/sources/art.ts";
import { settle } from "./support/time.ts";

type Said = Partial<Record<"fontWeights" | "displayFont" | "dots" | "pulse", boolean>>;

/** A host that says `said` on its protocol line, and hears Reduce Motion. */
function fakeHost(said: Said) {
  let listener: ((event: NativeEvent) => void) | null = null;
  let closer: (() => void) | null = null;
  const motion: boolean[] = [];
  return {
    motion,
    host: {
      onEvent: (each: (event: NativeEvent) => void) => {
        listener = each;
      },
      onClose: (each: () => void) => {
        closer = each;
      },
      setReduceMotion: (on: boolean) => motion.push(on),
    },
    speak: () => listener?.({ type: "protocol", nodeId: "root", patches: 1, ...said }),
    die: () => closer?.(),
  };
}

const NEW: Said = { fontWeights: true, displayFont: true, dots: true, pulse: true };
const alive: (() => void)[] = [];

/** The shell's registry hears a host that says `said`; it dies after the test. */
function sessionSays(said: Said): void {
  const fake = fakeHost(said);
  hostAbilities.note(fake.host);
  fake.speak();
  alive.push(fake.die);
}

afterEach(() => {
  for (const die of alive.splice(0)) die();
});

async function print(node: React.ReactNode): Promise<string> {
  const trees: string[] = [];
  const transport: NativeTransport = { send: (tree) => trees.push(tree), onEvent() {}, onClose() {}, simulate() {}, close() {} };
  const root = render(node, transport);
  await settle();
  root.unmount();
  return trees.at(-1) ?? "";
}

describe("what the hosts can draw", () => {
  test("nothing until a host says; what every live host says; back when the new one goes", () => {
    const registry = new HostRegistry();
    expect(registry.getSnapshot()).toEqual(NO_ABILITIES);
    const fresh = fakeHost(NEW);
    registry.note(fresh.host);
    fresh.speak();
    expect(registry.getSnapshot()).toEqual({ fontWeights: true, displayFont: true, dots: true, pulse: true });
    const old = fakeHost({});
    registry.note(old.host);
    old.speak();
    expect(registry.getSnapshot()).toEqual(NO_ABILITIES);
    old.die();
    expect(registry.getSnapshot().dots).toBe(true);
  });

  test("Reduce Motion reaches every host that takes it, on change and as it starts", () => {
    const registry = new HostRegistry();
    const first = fakeHost(NEW);
    const old = fakeHost({});
    registry.note(first.host);
    registry.note(old.host);
    first.speak();
    old.speak();
    registry.setReduceMotion(true);
    expect(first.motion).toEqual([false, true]);
    // An old host never gets the line: it would not know it.
    expect(old.motion).toEqual([]);
    const later = fakeHost(NEW);
    registry.note(later.host);
    later.speak();
    expect(later.motion).toEqual([true]);
    expect(registry.reducesMotion()).toBe(true);
  });
});

describe("numbers", () => {
  test("300 to 500 with the value, never under 400 below 40 points", () => {
    expect(numberWeight(76, 0)).toBe("300");
    expect(numberWeight(76, 0.15)).toBe("300");
    expect(numberWeight(76, 0.5)).toBe("400");
    expect(numberWeight(76, 0.72)).toBe("400");
    expect(numberWeight(76, 0.8)).toBe("500");
    expect(numberWeight(28, 0)).toBe("400");
    expect(numberWeight(28, 1)).toBe("500");
  });

  test("Inter Display on a new host, Regular or Medium as before on an older one", async () => {
    expect(numberFace(NO_ABILITIES, 76, 1)).toEqual({ fontWeight: "500" });
    expect(numberFace(NO_ABILITIES, 76, 0)).toEqual({});
    const card = (node: React.ReactNode) => (
      <Card look={{ inks: inkTokens("light"), ink: "matcha", air: false, houseDown: false, redact: false }} width={172} height={172}>
        {node}
      </Card>
    );
    const before = await print(card(<Num value="72" unit="%" size={76} />));
    expect(before).toContain('"72"');
    expect(before).not.toContain('"display"');
    sessionSays(NEW);
    const tree = await print(card(<Num value="72" unit="%" size={76} weight={0.2} />));
    expect(tree).toContain('"weight":"light","display":true');
  });
});

describe("dots", () => {
  test("a row is one <Dots> padded to Dashi's box on a new host, two masks on an older one", async () => {
    const row = <DotRow count={20} value={0.5} pitch={8} radius={0.3} lit="#112233" unlit="#445566" />;
    const before = await print(row);
    expect(before).not.toContain('"dots"');
    expect(before).toContain("svg");
    sessionSays(NEW);
    const after = await print(row);
    expect(after).toContain('"type":"dots"');
    expect(after).not.toContain("<circle");
    expect(after).toContain('"lit":10');
    // pitch/2 − r = 4 − 2.4.
    expect(after).toMatch(/"padding":1\.6/);
  });

  test("the album print is a few layers of rows × cells, every cell drawn once", () => {
    const layers = halftoneLayers(stockPrint("A song"));
    expect(layers.length).toBeLessThanOrEqual(10);
    let drawn = 0;
    for (const layer of layers) {
      expect(layer.cells.length).toBe(ART_GRID * ART_GRID);
      drawn += [...layer.cells].filter((cell) => cell === "1").length;
    }
    expect(drawn).toBe(ART_GRID * ART_GRID);
  });
});

describe("the Now tag", () => {
  test("breathes only where the host takes pulse", async () => {
    expect(await print(<NowTag tally="#E5322D" />)).not.toContain("pulse");
    sessionSays(NEW);
    const tree = await print(<NowTag tally="#E5322D" />);
    expect(tree).toContain('"pulse"');
    expect(tree).toContain('"periodMs":2000');
  });
});

describe("pass 52", () => {
  test("the gallery's previews read as the list does: Music is Small first", () => {
    const music = widgetInfo("media");
    expect(music).toBeDefined();
    const sizes = previewSizes(music ?? { kind: "media", name: "", ink: null, glyph: "spark", sizes: [], holdsPrivate: false, blurb: "" });
    expect(sizes[0]).toBe("small");
    expect([...sizes].sort((a, b) => SIZE_ORDER.indexOf(a) - SIZE_ORDER.indexOf(b))).toEqual(sizes);
  });

  test("a chosen card one row high has its tag across its edge, off the number", () => {
    expect(tagOnEdge("compact")).toBe(true);
    expect(tagOnEdge("mini")).toBe(true);
    expect(tagOnEdge("small")).toBe(false);
  });
});
