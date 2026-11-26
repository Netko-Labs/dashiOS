/** The one clock (D670) and the login screen's look per mode (D671). */

import { expect, test } from "bun:test";
import { render } from "@mirinjs/metal";
import { ClockHead, clockFace, clockParts, InksClock } from "../src/inks-clock.tsx";
import { LoginScreen } from "../src/login-screen.tsx";
import { LOGIN, LOGIN_LIGHT, loginColors } from "../src/theme/colors.ts";
import { contrastRatio } from "../src/theme/contrast.ts";
import { TYPE } from "../src/theme/measures.ts";
import { darkColors, lightColors } from "../src/theme/palette.ts";
import { fakeHost, layOut } from "./host.ts";
import { settle } from "./support/time.ts";

interface Node {
  type: string;
  props: Record<string, unknown>;
  children?: unknown[];
}
const isNode = (child: unknown): child is Node => typeof child === "object" && child !== null && "props" in child;

function all(tree: Node, keep: (node: Node) => boolean, out: Node[] = []): Node[] {
  if (keep(tree)) out.push(tree);
  for (const child of tree.children ?? []) if (isNode(child)) all(child, keep, out);
  return out;
}
/** A node's drawn props (Metal's names: size, weight, display, background, …), colours lower case. */
const style = (node: Node): Record<string, unknown> =>
  Object.fromEntries(Object.entries(node.props).map(([key, value]) => [key, typeof value === "string" && value.startsWith("#") ? value.toLowerCase() : value]));
const low = (hex: string): string => hex.toLowerCase();
const texts = (tree: Node): Node[] => all(tree, (node) => node.type === "text");
const words = (node: Node): string => (node.children ?? []).filter((child) => typeof child === "string").join("");

async function drawn(element: React.ReactElement): Promise<Node> {
  const host = fakeHost();
  const root = render(element, host.transport);
  await settle();
  layOut(host, root.nodeId("login-screen"));
  await settle();
  const tree = JSON.parse(host.last()) as Node;
  root.unmount();
  return tree;
}

test("a time splits into its hours and its minutes, whatever the locale's mark", () => {
  expect(clockParts("5:04")).toEqual(["5", "04"]);
  expect(clockParts("17.04")).toEqual(["17", "04"]);
  expect(clockParts("09:05")).toEqual(["09", "05"]);
  expect(clockParts("noon")).toBeNull();
});

test("the clock is hours over minutes at 120, ExtraLight Inter Display only where the host draws it", async () => {
  const shown = texts(await drawn(<InksClock time="14:02" color={LOGIN.ink} display />));
  expect(shown.map(words)).toEqual(["14", "02"]);
  for (const line of shown) expect(style(line)).toMatchObject({ size: TYPE.clock.size, lineHeight: TYPE.clock.line, display: true, weight: "extralight" });
  const older = texts(await drawn(<InksClock time="14:02" color={LOGIN.ink} display={false} />));
  for (const line of older) {
    expect(style(line).display).toBeUndefined();
    expect(style(line).weight).toBeUndefined();
  }
  expect(clockFace(false)).toEqual({});
});

test("the day is the formatter's string, upper case, over the clock", async () => {
  const shown = texts(await drawn(<ClockHead day="Sunday, November 15" time="14:02" ink={LOGIN.ink} display={false} />));
  expect(shown.map(words)).toEqual(["SUNDAY, NOVEMBER 15", "14", "02"]);
  expect(style(shown[0] as Node)).toMatchObject({ size: TYPE.inks.body.size, weight: "semibold" });
});

const screen = (mode: "light" | "dark", error = false) => (
  <LoginScreen
    day="Sunday, November 15"
    time="14:02"
    name="Alex Kim"
    value=""
    onChangeText={() => {}}
    onSubmit={() => {}}
    hint="Wrong password. Try again."
    error={error}
    mode={mode}
  />
);

test("the login screen draws the one clock, not a second one", async () => {
  const shown = texts(await drawn(screen("dark")));
  expect(shown.slice(0, 3).map(words)).toEqual(["SUNDAY, NOVEMBER 15", "14", "02"]);
  expect(shown.filter((node) => style(node).size === 264).map(words)).toEqual(["14", "02"]);
});

test("the field is a control's height in body type, its edge the focus ring while it has the keyboard (KB-2)", async () => {
  const [field] = all(await drawn(screen("dark")), (node) => node.type === "input");
  // On glass now (LK-1): no edge of its own at rest; the ring's purple while it has the keyboard.
  expect(style(field as Node)).toMatchObject({ height: 28, size: TYPE.body.size, focusBorderColor: low(LOGIN.focusRing) });
});

test("a wrong password is the mode's criticalInk, not a pink of its own", async () => {
  const wrong = (tree: Node) => texts(tree).find((node) => words(node).startsWith("Wrong"));
  expect(style(wrong(await drawn(screen("dark", true))) as Node).color).toBe(low(darkColors.criticalInk));
  expect(style(wrong(await drawn(screen("light", true))) as Node).color).toBe(low(lightColors.criticalInk));
});

test("the lock in Light is Light's look; the login screen's default is Dark's", async () => {
  const ground = (tree: Node) => style(tree);
  expect(ground(await drawn(screen("light")))).toMatchObject({ background: low(LOGIN_LIGHT.ground), focusRingColor: low(lightColors.focusRing) });
  const plain = await drawn(<LoginScreen day="d" time="1:00" name="A" value="" onChangeText={() => {}} onSubmit={() => {}} hint="" />);
  expect(ground(plain)).toMatchObject({ background: low(LOGIN.ground), focusRingColor: low(darkColors.focusRing) });
  expect(loginColors("light")).toBe(LOGIN_LIGHT);
});

/** The ground over the worst wallpaper for it: white under the dark wash, black under the light one. */
const over = (wash: string, wallpaper: string): string => {
  const alpha = Number.parseInt(wash.slice(7, 9), 16) / 255;
  const mix = (at: number) => {
    const top = Number.parseInt(wash.slice(at, at + 2), 16);
    const under = Number.parseInt(wallpaper.slice(at, at + 2), 16);
    return Math.round(top * alpha + under * (1 - alpha))
      .toString(16)
      .padStart(2, "0");
  };
  return `#${mix(1)}${mix(3)}${mix(5)}`;
};

test("both looks' words read on their ground over any wallpaper, and the ring over a middling one", () => {
  for (const [colors, worst] of [
    [LOGIN, "#ffffff"],
    [LOGIN_LIGHT, "#000000"],
  ] as const) {
    const ground = over(colors.ground, worst);
    expect(contrastRatio(colors.ink, ground)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.muted, ground)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(colors.wrong, ground)).toBeGreaterThanOrEqual(4);
    expect(contrastRatio(colors.focusRing, over(colors.ground, "#808080"))).toBeGreaterThanOrEqual(3);
  }
  // Light's ring holds 3:1 even over a black wallpaper.
  expect(contrastRatio(LOGIN_LIGHT.focusRing, over(LOGIN_LIGHT.ground, "#000000"))).toBeGreaterThanOrEqual(3);
});
