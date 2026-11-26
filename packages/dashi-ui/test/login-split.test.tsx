/**
 * The split sign-in screen (lock-v3 C, LK-1 to LK-4, decisions.md D803): at 1280 pt wide and up, the
 * clock at the left edge at 264, who signs in with initials on regular glass, the power pills thin, Today
 * at the right, the veil over the ground where the host draws glass; narrower, the centred column as it was.
 */

import { expect, test } from "bun:test";
import { render, Text } from "@mirinjs/metal";
import { LoginScreen } from "../src/login-screen.tsx";
import { initialsOf, isSplitWidth, splitInset } from "../src/login-split.tsx";
import { LOGIN_LIGHT } from "../src/theme/colors.ts";
import { GLASS } from "../src/theme/glass.ts";
import { TYPE } from "../src/theme/measures.ts";
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

/** The login screen drawn on a screen `width` wide: laid out once, as the host does. */
async function drawnAt(width: number, today = false): Promise<Node> {
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
      {...(today ? { today: <Text>Today</Text> } : {})}
    />,
    host.transport,
  );
  await settle();
  const id = root.nodeId("login-screen");
  if (id) host.emit({ type: "resize", nodeId: id, bounds: { x: 0, y: 0, width, height: 1029 } });
  await settle();
  const tree = JSON.parse(host.last()) as Node;
  root.unmount();
  return tree;
}

test("the split starts at GLASS.lock.splitMin; the inset is 88 on the laptop, 96 on a 1920-wide screen", () => {
  expect(isSplitWidth(GLASS.lock.splitMin - 1)).toBe(false);
  expect(isSplitWidth(GLASS.lock.splitMin)).toBe(true);
  expect(splitInset(1646)).toBe(GLASS.lock.inset);
  expect(splitInset(1920)).toBe(GLASS.lock.insetWide);
  expect(initialsOf("Alex Kim")).toBe("AK");
  expect(initialsOf("alexk")).toBe("A");
  expect(initialsOf("  ")).toBe("?");
});

test("wide: the day over hours over minutes at 264 on 216, the initials, the field, the three pills, Today", async () => {
  const tree = await drawnAt(1646, true);
  const shown = texts(tree);
  expect(shown).toContain("WEDNESDAY, NOVEMBER 25");
  expect(shown).toContain("AK");
  expect(shown).toContain("Alex Kim");
  expect(shown).toContain("Today");
  expect(shown.filter((each) => ["Sleep", "Restart", "Shut Down"].includes(each))).toEqual(["Sleep", "Restart", "Shut Down"]);
  const clock = all(tree, (node) => node.type === "text" && node.props.size === GLASS.lock.clock.size);
  expect(clock.map(words)).toEqual(["4", "48"]);
  for (const line of clock) expect(line.props.lineHeight).toBe(GLASS.lock.clock.line);
  // The power pills come after Today in the tree: Tab reaches the field, Today, then the pills (LK-5).
  expect(shown.indexOf("Today")).toBeLessThan(shown.indexOf("Sleep"));
});

test("narrow: the centred column as it was, the 120 clock, no Today", async () => {
  const tree = await drawnAt(1097, true);
  const shown = texts(tree);
  expect(shown).not.toContain("Today");
  const clock = all(tree, (node) => node.type === "text" && node.props.size === TYPE.clock.size);
  expect(clock.map(words)).toEqual(["4", "48"]);
  // The column keeps its wash and no veil: only the split frosts (D803).
  expect(String(tree.props.background).toLowerCase()).toBe(LOGIN_LIGHT.ground.toLowerCase());
  expect(tree.props.material).toBeUndefined();
});
