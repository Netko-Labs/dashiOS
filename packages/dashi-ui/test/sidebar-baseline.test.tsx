import { expect, test } from "bun:test";
import { render } from "@mirinjs/metal";
import { SidebarItem } from "../src/sidebar.tsx";
import { fakeHost } from "./host.ts";
import { settle } from "./support/time.ts";

interface Node {
  type: string;
  props: Record<string, unknown>;
  children?: unknown[];
}
const isNode = (child: unknown): child is Node => typeof child === "object" && child !== null && "props" in child;
const find = (node: Node, id: string | undefined): Node | null => {
  if (node.props.id === id) return node;
  for (const child of node.children ?? []) {
    const found = isNode(child) ? find(child, id) : null;
    if (found) return found;
  }
  return null;
};

test("a sidebar row's count sits on its name's baseline, not centered beside it", async () => {
  // 12 pt beside 13 pt: with the boxes centered the smaller text sat up to 1 pt high.
  const host = fakeHost();
  const root = render(<SidebarItem testID="row" label="All Notes" badge="12" selected={false} onPress={() => {}} glyph="<svg/>" />, host.transport);
  await settle();
  const tree = JSON.parse(host.last()) as Node;
  const words = find(tree, root.nodeId("row:words"));
  expect(words?.props).toMatchObject({ direction: "row", align: "baseline" });
  // The name and the count, and nothing without words: a glyph has no baseline and stays centered in the row.
  expect(JSON.stringify(words)).toContain("All Notes");
  expect(JSON.stringify(words)).toContain('"12"');
  expect(JSON.stringify(words)).not.toContain("svg");
  expect(find(tree, root.nodeId("row"))?.props.align).toBe("center");
  root.unmount();
});
