/** The lock follows the person's mode (Q2, D671); its clock is the one clock (Q1, D670). */

import { afterEach, expect, test } from "bun:test";
import { Appearance, LOGIN, LOGIN_LIGHT } from "@dashi/ui";
import { type NativeEvent, type NativeRoot, type NativeTransport, render } from "@mirinjs/metal";
import { LockScreen } from "../src/lock/lib/screen.tsx";
import { lockTime, setWidgetHub, WidgetHub } from "../src/widgets/index.ts";
import { fakeClockEachTest, settle } from "./support/time.ts";

fakeClockEachTest();
let root: NativeRoot | null = null;
afterEach(() => {
  root?.unmount();
  root = null;
  setWidgetHub(null);
});

interface Node {
  type: string;
  props: Record<string, unknown>;
  children?: unknown[];
}
const isNode = (child: unknown): child is Node => typeof child === "object" && child !== null && "props" in child;
function find(tree: Node, keep: (node: Node) => boolean): Node | undefined {
  if (keep(tree)) return tree;
  for (const child of tree.children ?? [])
    if (isNode(child)) {
      const hit = find(child, keep);
      if (hit) return hit;
    }
  return undefined;
}

async function lockIn(dark: boolean): Promise<{ tree: Node; root: NativeRoot }> {
  setWidgetHub(new WidgetHub({ notify() {}, live: false }));
  const trees: string[] = [];
  const listeners: ((event: NativeEvent) => void)[] = [];
  const transport: NativeTransport = {
    send: (tree) => trees.push(tree),
    onEvent: (listener) => listeners.push(listener),
    onClose() {},
    simulate() {},
    close() {},
  };
  root = render(
    <Appearance dark={dark}>
      <LockScreen name="Alex Kim" onSubmit={async () => "wrong"} waitMs={() => 0} />
    </Appearance>,
    transport,
  );
  await settle();
  // A small landscape screen (1024 × 768): the clock 30 % of its height, hours over minutes (D806).
  const screen = root.nodeId("login-screen");
  for (const listener of listeners) if (screen) listener({ type: "resize", nodeId: screen, bounds: { x: 0, y: 0, width: 1024, height: 768 } });
  await settle();
  return { tree: JSON.parse(trees.at(-1) ?? "{}") as Node, root };
}

for (const [mode, colors] of [
  ["light", LOGIN_LIGHT],
  ["dark", LOGIN],
] as const) {
  test(`in ${mode} the lock is ${mode}'s look, with the clock hours over minutes at the size the screen gives it`, async () => {
    const { tree, root } = await lockIn(mode === "dark");
    const screen = find(tree, (node) => node.props.id === root.nodeId("login-screen"));
    expect(String(screen?.props.background).toLowerCase()).toBe(colors.ground.toLowerCase());
    const clock = find(tree, (node) => node.props.id === root.nodeId("clock"));
    expect((clock?.children ?? []).filter(isNode).map((line) => line.props.size)).toEqual([230, 230]);
  });
}

test("the lock's time pads its hours in 24-hour time", () => {
  const nine = new Date(2026, 10, 15, 9, 5).getTime();
  expect(lockTime(nine, true)).toBe("09:05");
  expect(lockTime(nine, false)).toBe("9:05");
});
