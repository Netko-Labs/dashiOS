import { expect, test } from "bun:test";
import { render } from "@mirinjs/metal";
import { MENU, menuHeight } from "../src/menu-place.ts";
import { PopupMenu } from "../src/sheet.tsx";
import { fakeHost, settle } from "./host.ts";

// A menu with more choices than the window has room for (Settings' "More…" in a short window)
// is as tall as the window allows and scrolls its rows, so every choice can be reached.

interface Node {
  props: Record<string, unknown>;
  children?: unknown[];
}
const isNode = (child: unknown): child is Node => typeof child === "object" && child !== null && "props" in child;
function find(node: Node, id: string): Node | undefined {
  if (node.props.id === id) return node;
  return (node.children ?? []).map((child) => (isNode(child) ? find(child, id) : undefined)).find(Boolean);
}

const items = Array.from({ length: 30 }, (_, index) => ({ label: `Choice ${index + 1}`, onPress: () => {} }));

test("a menu taller than the window scrolls its rows inside the window; a short one does not", async () => {
  for (const [room, scrolls] of [
    [300, true],
    [1200, false],
  ] as const) {
    const host = fakeHost();
    const root = render(<PopupMenu testID="more" x={20} y={40} items={items} onClose={() => {}} />, host.transport);
    await settle();
    const away = root.nodeId("more:away");
    if (away === undefined) throw new Error("no menu");
    host.emit({ type: "resize", nodeId: away, bounds: { x: 0, y: 0, width: 800, height: room } });
    await settle();
    const tree = JSON.parse(host.last()) as Node;
    const card = find(tree, root.nodeId("more") ?? "");
    const rows = root.nodeId("more:rows");
    expect(rows !== undefined).toBe(scrolls);
    if (scrolls) {
      expect(card?.props.height).toBe(room - 2 * MENU.margin);
      expect(find(tree, rows ?? "")?.props.scroll).toBe(true);
      // Every choice is there to scroll to, each at its full height.
      expect(root.nodeId("more:Choice 30")).toBeDefined();
    } else {
      expect(card?.props.height).toBeUndefined();
      expect(menuHeight(items.map(() => "item"))).toBeLessThan(room);
    }
    root.unmount();
  }
});
