import { expect, test } from "bun:test";
import { render, View } from "@mirinjs/metal";
import type { ReactNode } from "react";
import { AlertWindow } from "../src/alert.tsx";
import { Button } from "../src/button.tsx";
import { Choices } from "../src/choices.tsx";
import { Segmented } from "../src/fields.tsx";
import { LOGIN_FOCUS_RING, LoginScreen } from "../src/login-screen.tsx";
import { MenuList } from "../src/popup-menu.tsx";
import { Sheet } from "../src/sheet.tsx";
import { SidebarItem } from "../src/sidebar.tsx";
import { Switch } from "../src/switch.tsx";
import { Appearance } from "../src/theme/appearance.ts";
import { contrastRatio } from "../src/theme/contrast.ts";
import { darkColors, lightColors } from "../src/theme/palette.ts";
import { ToolbarButton } from "../src/window.tsx";
import { fakeHost, settle } from "./host.ts";

// The focus ring is purple (KB-2) in every Dashi window, whatever root it is
// in: Metal draws the nearest `focusRingColor` on the way up, and without one
// its own blue.

interface Node {
  type: string;
  props: Record<string, unknown>;
  children?: unknown[];
}

const isNode = (child: unknown): child is Node => typeof child === "object" && child !== null && "props" in child;

/** The ring color each focusable view in a sent tree would draw (null: Metal's blue). */
function rings(tree: Node, around: string | null = null, out: Record<string, string | null> = {}): Record<string, string | null> {
  const ring = typeof tree.props.focusRingColor === "string" ? tree.props.focusRingColor : around;
  if (tree.props.focusable === true) out[String(tree.props.id)] = ring;
  for (const child of tree.children ?? []) if (isNode(child)) rings(child, ring, out);
  return out;
}

async function ringsIn(element: ReactNode): Promise<(string | null)[]> {
  const host = fakeHost();
  const root = render(element, host.transport);
  await settle();
  const found = Object.values(rings(JSON.parse(host.last()) as Node));
  root.unmount();
  return found;
}

const noop = (): void => {};

/** Every focusable control of @dashi/ui, under a root that names no ring. */
function Controls() {
  return (
    <View>
      <Button testID="go" label="Go" onPress={noop} />
      <Choices testID="size" value="m" onChange={noop} options={[{ value: "m", label: "Medium" }]} />
      <Segmented testID="view" value="a" onChange={noop} options={[{ value: "a", label: "A" }]} />
      <Switch testID="wifi" on onChange={noop} />
      <SidebarItem testID="row" label="Row" selected={false} onPress={noop} />
      <ToolbarButton testID="tool" glyph="<svg/>" tooltip="Tool" onPress={noop} />
      <MenuList items={[{ label: "Open", onPress: noop }]} />
    </View>
  );
}

test("every focusable control rings in purple under any root, Light and Dark (KB-2)", async () => {
  for (const [dark, colors] of [
    [false, lightColors],
    [true, darkColors],
  ] as const) {
    const found = await ringsIn(
      <Appearance dark={dark}>
        <Controls />
      </Appearance>,
    );
    expect(found.length).toBe(7);
    expect(found.every((ring) => ring === colors.focusRing)).toBe(true);
  }
});

test("the ring is shiso purple, the agents' color and the keyboard's, in both modes; never kombu", () => {
  expect(lightColors.focusRing).toBe("#6E56CF");
  for (const colors of [lightColors, darkColors]) {
    expect(colors.focusRing).toBe(colors.agent);
    expect(colors.focusRing).not.toBe(colors.selection);
    // Beside a green switch or an "on" pill the ring is another hue, so it never vanishes into them.
    expect(contrastRatio(colors.focusRing, "#ffffff")).not.toBeCloseTo(contrastRatio(colors.selection, "#ffffff"), 1);
  }
  // One source: the login screen's is Dark's.
  expect(LOGIN_FOCUS_RING).toBe(darkColors.focusRing);
});

test("the roots @dashi/ui draws name the ring too: a sheet, an alert window, the login screen", async () => {
  for (const [dark, colors] of [
    [false, lightColors],
    [true, darkColors],
  ] as const) {
    const host = fakeHost();
    const root = render(
      <Appearance dark={dark}>
        <View>
          <AlertWindow question="Quit?" glyph="<svg/>" buttons={[{ label: "Quit", testID: "quit", onPress: noop }]} />
          <Sheet testID="ask">
            <View />
          </Sheet>
        </View>
      </Appearance>,
      host.transport,
    );
    await settle();
    const tree = JSON.parse(host.last()) as Node;
    const props = (testID: string): Record<string, unknown> => {
      const id = root.nodeId(testID);
      const find = (node: Node): Record<string, unknown> | undefined =>
        node.props.id === id ? node.props : (node.children ?? []).map((child) => (isNode(child) ? find(child) : undefined)).find(Boolean);
      return find(tree) ?? {};
    };
    expect(props("alert").focusRingColor).toBe(colors.focusRing);
    expect(props("ask:scrim").focusRingColor).toBe(colors.focusRing);
    root.unmount();
  }
  const login = fakeHost();
  const screen = render(
    <LoginScreen day="Friday" time="9:41" name="Alex Kim" value="" hint="Enter your password" onChangeText={noop} onSubmit={noop} />,
    login.transport,
  );
  await settle();
  expect((JSON.parse(login.last()) as Node).props.focusRingColor).toBe(LOGIN_FOCUS_RING);
  screen.unmount();
  // The login screen's ground is dark in either mode: its ring stands 3:1 on it.
  expect(contrastRatio(LOGIN_FOCUS_RING, "#140e22")).toBeGreaterThanOrEqual(3);
});
