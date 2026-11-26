/**
 * The kit on glass (theme/on-glass.ts, frosted.tsx; design.html GL-1 to GL-6, CO-6, CO-9, KB-2): a surface
 * wears a level only on a host that takes it, with its solid twin as its fill; everything under it paints
 * with the glass palettes; a third layer and glass turned off are the twin; a tooltip never is glass.
 */

import { describe, expect, test } from "bun:test";
import { Text, View } from "@mirinjs/metal";
import { type ReactNode, useContext } from "react";
import { Frosted, OffGlass, useFocusGap, useGlassTone } from "../src/frosted.tsx";
import { Switch } from "../src/switch.tsx";
import { Appearance, useColors } from "../src/theme/appearance.ts";
import { contrastRatio } from "../src/theme/contrast.ts";
import { controlPalette } from "../src/theme/controls.ts";
import { GLASS } from "../src/theme/glass.ts";
import { inkTokens } from "../src/theme/inks.ts";
import { hexToOklch } from "../src/theme/lib/oklch.ts";
import { glassControls, glassEdge, glassInkTokens, paintedPalette, vibrantInks, WindowFocusContext } from "../src/theme/on-glass.ts";
import { darkColors, lightColors } from "../src/theme/palette.ts";
import { settle } from "./support/time.ts";
import { sent } from "./support/tree.ts";

/** The host says it takes glass and the ring's gap (patches 0: the fake host keeps getting whole trees). */
const SAYS_GLASS = { type: "protocol", nodeId: "root", patches: 0, glass: true, focusGap: true } as const;
const REGULAR = { level: "regular", tone: null } as const;

describe("the vibrant inks (GL-1)", () => {
  test("neutral until the compositor says a tone, then leaning to its hue, no more than the token's chroma", () => {
    const neutral = vibrantInks(false, null);
    expect(hexToOklch(neutral.primary).C).toBeLessThan(0.002);
    expect(hexToOklch(neutral.primary).L).toBeCloseTo(GLASS.ink.light.primary.L, 2);
    const blue = vibrantInks(false, "#2050c0");
    const leaned = hexToOklch(blue.secondary);
    expect(leaned.C).toBeGreaterThan(0.02);
    expect(leaned.C).toBeLessThanOrEqual(GLASS.ink.light.secondary.C + 0.002);
    expect(Math.abs(leaned.H - hexToOklch("#2050c0").H)).toBeLessThan(3);
    // A grey backdrop gives grey words.
    expect(hexToOklch(vibrantInks(true, "#808080").primary).C).toBeLessThan(0.002);
  });

  test("words keep 4.5:1 on each level's solid twin, the floor's own target where glass gives way", () => {
    for (const dark of [false, true]) {
      const { primary, secondary } = vibrantInks(dark, "#c04020");
      for (const level of ["thin", "regular", "thick", "paper"] as const) {
        const twin = GLASS.levels[level][dark ? "dark" : "light"].solid;
        expect(contrastRatio(primary, twin)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(secondary, twin)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe("the palettes on glass", () => {
  test("the window look: vibrant words, the glass edge, white fills, the stepped inks, links in ink", () => {
    const light = paintedPalette(lightColors, false, REGULAR, true);
    expect(light.text).toBe(vibrantInks(false, null).primary);
    expect(light.textMuted).toBe(vibrantInks(false, null).secondary);
    expect(light.controlEdge).toBe(glassEdge(false));
    expect(light.accentInk).toBe(light.text);
    expect(light.ume).toBe(GLASS.inks.light.ume);
    expect(light.microphone).toBe(GLASS.inks.light.microphone);
    expect(light.microphoneWash.endsWith("1f")).toBe(true);
    expect(light.onSelection).toBe(light.text);
    expect(light.selectionWash).toBe(`${lightColors.selection.slice(0, 7)}38`);
    const dark = paintedPalette(darkColors, true, REGULAR, true);
    expect(dark.ume).toBe(GLASS.inks.dark.umeOnFill);
    // The same call gives the same palette back (no repaint for nothing).
    expect(paintedPalette(lightColors, false, REGULAR, true)).toBe(light);
    expect(paintedPalette(lightColors, false, null, true)).toBe(lightColors);
  });

  test("the glass edge keeps 3:1 on every level's twin, both modes (CO-6)", () => {
    for (const dark of [false, true]) {
      for (const level of ["thin", "regular", "thick", "paper"] as const) {
        expect(contrastRatio(glassEdge(dark), GLASS.levels[level][dark ? "dark" : "light"].solid)).toBeGreaterThanOrEqual(3);
      }
    }
  });

  test("a window without focus turns its selection neutral, on glass or not (CO-9)", () => {
    const off = paintedPalette(lightColors, false, null, false);
    expect(off.selectionWash).toBe(`${lightColors.text}1a`);
    expect(off.selectionBar).toBe(`${lightColors.text}8c`);
    const glassOff = paintedPalette(lightColors, false, REGULAR, false);
    expect(glassOff.selectionWash.startsWith(vibrantInks(false, null).primary)).toBe(true);
  });

  test("the panel look: fills for off tiles, the glass edge as its outline", () => {
    const panel = glassControls(controlPalette(false), false, REGULAR);
    expect(panel.edge).toBe(glassEdge(false));
    expect(panel.text).toBe(vibrantInks(false, null).primary);
    expect(controlPalette(false).edge).toBeUndefined();
  });

  test("the Inks on glass: Light matcha and wakame take their step (GL-5)", () => {
    const light = glassInkTokens(inkTokens("light"));
    expect(light.ink.matcha).toBe(GLASS.inks.light.matcha);
    expect(light.ink.wakame).toBe(GLASS.inks.light.wakame);
    const dark = inkTokens("dark");
    expect(glassInkTokens(dark)).toBe(dark);
  });
});

/** What a probe under `wrap` reads: its words' colour and the tone. */
function Probe({ id }: { id: string }) {
  const colors = useColors();
  const tone = useGlassTone();
  const focused = useContext(WindowFocusContext);
  return (
    <View testID={id}>
      <Text>{`${colors.text}|${tone ?? "none"}|${focused}`}</Text>
    </View>
  );
}

const tree = (children: ReactNode) => <Appearance dark={false}>{children}</Appearance>;

describe("Frosted", () => {
  test("its solid twin only, until the host says it takes glass; then the material too", async () => {
    const { node, host } = await sent(
      tree(
        <Frosted level="regular" testID="panel">
          <Probe id="probe" />
        </Frosted>,
      ),
    );
    expect(node("panel")?.props.material).toBeUndefined();
    expect(node("panel")?.props.background).toBe(GLASS.levels.regular.light.solid);
    host.emit(SAYS_GLASS);
    await settle();
    expect(node("panel")?.props.material).toBe("regular");
    host.emit({ type: "glass", nodeId: "root", drawing: true, tone: "#336699" });
    await settle();
    const words = JSON.stringify(node("probe"));
    expect(words).toContain("#336699");
    expect(words).toContain(vibrantInks(false, "#336699").primary);
  });

  test("a third layer and glass turned off are the twin, with neutral inks (GL-2, GL-3)", async () => {
    const { node, host } = await sent(
      tree(
        <Frosted level="regular" testID="one">
          <Frosted level="paper" testID="two">
            <Frosted level="regular" testID="three" />
          </Frosted>
          <Frosted level="regular" solid testID="off">
            <Probe id="probe" />
          </Frosted>
        </Frosted>,
      ),
    );
    host.emit(SAYS_GLASS);
    host.emit({ type: "glass", nodeId: "root", drawing: true, tone: "#336699" });
    await settle();
    expect(node("two")?.props.material).toBe("paper");
    expect(node("three")?.props.material).toBeUndefined();
    expect(node("off")?.props.material).toBeUndefined();
    expect(JSON.stringify(node("probe"))).toContain(`${vibrantInks(false, null).primary}|none`);
  });

  test("off glass, a window's inks again (GL-6: a tooltip)", async () => {
    const { node } = await sent(
      tree(
        <Frosted level="regular">
          <OffGlass>
            <Probe id="probe" />
          </OffGlass>
        </Frosted>,
      ),
    );
    expect(JSON.stringify(node("probe"))).toContain(`${lightColors.text}|none|true`);
  });

  test("an off switch on glass is the glass edge only (CO-6)", async () => {
    const { node, host } = await sent(
      tree(
        <Frosted level="regular">
          <Switch testID="switch" on={false} onChange={() => {}} />
        </Frosted>,
      ),
    );
    host.emit(SAYS_GLASS);
    await settle();
    const props = node("switch")?.props ?? {};
    expect(props.borderColor).toBe(glassEdge(false));
    expect(props.background ?? "transparent").not.toBe(lightColors.track);
  });
});

describe("the ring's gap on the accent (KB-2)", () => {
  function Lit({ lit }: { lit: boolean }) {
    return <View testID="lit" style={{ ...useFocusGap(lit, "#ffffff") }} />;
  }

  test("sent only when lit, and only to a host that draws it", async () => {
    const { node, host } = await sent(<Lit lit />);
    expect(node("lit")?.props.focusRingGapColor).toBeUndefined();
    host.emit(SAYS_GLASS);
    await settle();
    expect(node("lit")?.props.focusRingGapColor).toBe("#ffffff");
    const plain = await sent(<Lit lit={false} />);
    plain.host.emit(SAYS_GLASS);
    await settle();
    expect(plain.node("lit")?.props.focusRingGapColor).toBeUndefined();
  });
});
