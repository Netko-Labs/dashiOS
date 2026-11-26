/**
 * The split sign-in screen on every screen size (lock-v3 C and #narrow, LK-1 to LK-5, decisions.md D803,
 * D806): a wide screen as C's frame; a smaller landscape one with Today a narrower pane and the clock 30 %
 * of its height; a vertical one with the pills beside who signs in and Today a bottom sheet, open when
 * there is room. The clock is hours over minutes everywhere.
 */

import { expect, test } from "bun:test";
import { render, Text } from "@mirinjs/metal";
import { clockBlock, clockFor, lockLayout, lockShape, paneWidth, WHO_HEIGHT } from "../src/lock-layout.ts";
import { LoginScreen } from "../src/login-screen.tsx";
import { initialsOf } from "../src/login-split.tsx";
import { LOGIN_LIGHT } from "../src/theme/colors.ts";
import { GLASS } from "../src/theme/glass.ts";
import { fakeHost } from "./host.ts";
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
const words = (node: Node): string => (node.children ?? []).filter((child) => typeof child === "string").join("");
const texts = (tree: Node): string[] => all(tree, (node) => node.type === "text").map(words);

/** The login screen on a screen `width` × `height`: laid out once, as the host does. */
async function drawnAt(width: number, height: number, today = false): Promise<Node> {
  const host = fakeHost();
  const root = render(
    <LoginScreen
      day="Wednesday, November 25"
      time="4:48"
      name="Alex Kim"
      value=""
      hint="Enter your password"
      onChangeText={() => {}}
      onSubmit={() => {}}
      onPower={() => {}}
      mode="light"
      {...(today ? { today: (place: { kind: string }) => <Text>{`Today in a ${place.kind}`}</Text> } : {})}
    />,
    host.transport,
  );
  await settle();
  const id = root.nodeId("login-screen");
  if (id) host.emit({ type: "resize", nodeId: id, bounds: { x: 0, y: 0, width, height } });
  await settle();
  const tree = JSON.parse(host.last()) as Node;
  root.unmount();
  return tree;
}

test("the shapes: wide from 1646 on a landscape screen, the pane below it, vertical when taller than wide", () => {
  expect(lockShape(1646, 1029)).toBe("wide");
  expect(lockShape(1645, 1029)).toBe("pane");
  expect(lockShape(1024, 768)).toBe("pane");
  expect(lockShape(1080, 1920)).toBe("vertical");
  expect(paneWidth(1024)).toBe(424);
  expect(paneWidth(1280)).toBe(680);
  expect(paneWidth(800)).toBe(GLASS.lock.panes.min);
  expect(paneWidth(1600)).toBe(GLASS.lock.panes.max);
  expect(initialsOf("Alex Kim")).toBe("AK");
  expect(initialsOf("  ")).toBe("?");
});

test("the clock: 30 % of the height, at most 264 / 216, its line 0.82 of its size", () => {
  expect(clockFor(768)).toEqual({ size: 230, line: 189 });
  expect(clockFor(800)).toEqual({ size: 240, line: 197 });
  expect(clockFor(1920)).toEqual(GLASS.lock.clock);
});

test("wide is C's frame: 88 in (96 at 1920), who signs in 315 above the foot, the pills at the foot, a 744 pane", () => {
  const laptop = lockLayout(1646, 1029);
  expect(laptop).toMatchObject({ inset: 88, top: 104, clock: GLASS.lock.clock, who: { top: 1029 - 315 }, power: { left: 88, bottom: 44 } });
  expect(laptop.today).toMatchObject({ kind: "pane", width: 744, padding: 46, smalls: 3 });
  expect(lockLayout(1920, 1080).inset).toBe(96);
});

test("a smaller landscape screen: Today a narrower pane, two small widgets under 520 inside, who signs in under the clock", () => {
  const small = lockLayout(1024, 768);
  expect(small).toMatchObject({ shape: "pane", inset: 64, top: 44, clock: { size: 230, line: 189 }, power: { left: 64, bottom: 24 } });
  expect(small.who.top).toBe(44 + clockBlock(189) + 28);
  expect(small.today).toEqual({ kind: "pane", width: 424, padding: 28, top: 56, smalls: 2 });
  const hd = lockLayout(1280, 800);
  expect(hd.inset).toBe(72);
  expect(hd.today).toMatchObject({ width: 680, smalls: 3 });
  // It all fits above the foot.
  expect(small.who.top + WHO_HEIGHT).toBeLessThan(768);
});

test("vertical: the pills beside who signs in, Today a sheet open when there is room, its peek when not", () => {
  const tall = lockLayout(1080, 1920);
  expect(tall).toMatchObject({ shape: "vertical", inset: 64, top: 120, clock: GLASS.lock.clock, today: { kind: "sheet", open: true } });
  expect(tall.power).toEqual({ right: 64, top: tall.who.top + (52 - 28) / 2 });
  const short = lockLayout(686, 1097);
  expect(short.today).toEqual({ kind: "sheet", open: false, width: 686 - 24 });
  expect(short.glance.top).toBe(1097 - GLASS.lock.sheet.peek + 30);
});

test("drawn wide: 264 / 216, hours over minutes, the initials, the three pills after Today in the tree", async () => {
  const tree = await drawnAt(1646, 1029, true);
  const shown = texts(tree);
  expect(shown).toContain("WEDNESDAY, NOVEMBER 25");
  expect(shown).toContain("AK");
  expect(shown).toContain("Today in a pane");
  const clock = all(tree, (node) => node.type === "text" && node.props.size === 264);
  expect(clock.map(words)).toEqual(["4", "48"]);
  expect(shown.indexOf("Today in a pane")).toBeLessThan(shown.indexOf("Sleep"));
});

test("drawn small and vertical: still hours over minutes, at the size the height gives; Today a pane, then a sheet", async () => {
  const small = await drawnAt(1024, 768, true);
  expect(all(small, (node) => node.type === "text" && node.props.size === 230).map(words)).toEqual(["4", "48"]);
  expect(texts(small)).toContain("Today in a pane");
  const vertical = await drawnAt(1080, 1920, true);
  expect(all(vertical, (node) => node.type === "text" && node.props.size === 264).map(words)).toEqual(["4", "48"]);
  expect(texts(vertical)).toContain("Today in a sheet");
  // The ground is the mode's wash; no veil where the host draws no glass.
  expect(String(vertical.props.background).toLowerCase()).toBe(LOGIN_LIGHT.ground.toLowerCase());
  expect(vertical.props.material).toBeUndefined();
});
