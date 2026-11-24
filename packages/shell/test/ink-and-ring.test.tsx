import { expect, test } from "bun:test";
import { Appearance, Button, contrastRatio, DARK_CONTROLS, darkColors, LIGHT_CONTROLS, LOGIN_FOCUS_RING, lightColors } from "@dashi/ui";
import { type NativeEvent, type NativeTransport, render, View } from "@mirinjs/metal";
import { ConfirmSheet } from "../src/menus/lib/power-sheets.tsx";
import { settle } from "./support/time.ts";

// One purple ring and ink primary buttons (docs/design.html KB-2, UI-4;
// decisions.md D15, D16): the shell's own palette and its sheets take
// @dashi/ui's ring and its Button (UI-8), and nothing that goes ahead is green.

function fakeHost(): { transport: NativeTransport; last: () => string } {
  const trees: string[] = [];
  const transport: NativeTransport = {
    send: (tree) => trees.push(tree),
    onEvent: (_listener: (event: NativeEvent) => void) => {},
    onClose() {},
    simulate() {},
    close() {},
  };
  return { transport, last: () => trees.at(-1) ?? "" };
}

test("Control Center's and Settings' ring is @dashi/ui's, 3:1 on every ground of theirs, Light and Dark", () => {
  expect(LIGHT_CONTROLS.focus).toBe(lightColors.focusRing);
  expect(DARK_CONTROLS.focus).toBe(darkColors.focusRing);
  expect(LOGIN_FOCUS_RING).toBe(darkColors.focusRing);
  for (const palette of [LIGHT_CONTROLS, DARK_CONTROLS]) {
    const grounds = [palette.surface, palette.off, palette.window, palette.sidebar, palette.chip];
    expect(grounds.filter((ground) => contrastRatio(palette.focus, ground) < 3)).toEqual([]);
  }
});

test("a pill's ink button keeps its words AA at rest and under the pointer", () => {
  for (const [palette, colors] of [
    [LIGHT_CONTROLS, lightColors],
    [DARK_CONTROLS, darkColors],
  ] as const) {
    for (const fill of [palette.text, colors.primaryHover]) expect(contrastRatio(palette.window, fill)).toBeGreaterThanOrEqual(4.5);
  }
});

test("a shell sheet's go-ahead is the kit's ink Button, never green, Light and Dark", async () => {
  for (const [dark, colors] of [
    [false, lightColors],
    [true, darkColors],
  ] as const) {
    const host = fakeHost();
    const root = render(
      <Appearance dark={dark}>
        <View>
          <ConfirmSheet what="restart" onConfirm={() => {}} onCancel={() => {}} />
          <Button look="panel" label="Continue" primary testID="pill" onPress={() => {}} />
        </View>
      </Appearance>,
      host.transport,
    );
    await settle();
    const frame = host.last();
    expect(frame.split(`"background":"${colors.primary}"`).length - 1).toBeGreaterThanOrEqual(1);
    expect(frame).toContain(`"hoverBackground":"${colors.primaryHover}"`);
    expect(frame).toContain(`"color":"${colors.onPrimary}"`);
    expect(frame).not.toContain(colors.selection);
    root.unmount();
  }
});
