/**
 * The chooser's own measures (review 17). Its "Save as" field collapsed to a
 * sliver, its label wrapping, in a row of parts that keep their width: the
 * field now takes the row's room, never under a name's worth, and the label
 * stays on one line.
 */

import { afterAll, expect, test } from "bun:test";
import { type NativeTransport, render } from "@mirinjs/metal";
import type { ReactElement } from "react";
import { ChooserSheet, chooserRequest, openChooser } from "../apps/files/chooser/index.ts";

interface Node {
  type: string;
  props?: Record<string, unknown>;
  children?: Array<Node | string>;
}

/** The tree the host was sent, and a node by its testID with its parent. */
function tree(element: ReactElement): Promise<(testID: string) => { node: Node; parent: Node | null }> {
  const trees: string[] = [];
  const transport: NativeTransport = { send: (sent) => void trees.push(sent), onEvent() {}, onClose() {}, simulate() {}, close() {} };
  const mounted = render(element, transport);
  return new Promise((done) =>
    setTimeout(() => {
      const root = JSON.parse(trees.at(-1) ?? "{}") as Node;
      const ids = new Map(["chooser", "chooser:name-box", "chooser:name"].map((testID) => [testID, mounted.nodeId(testID)]));
      mounted.unmount();
      const lookup = (testID: string) => {
        const found = walk(root, null, ids.get(testID));
        if (!found) throw new Error(`no ${testID}`);
        return found;
      };
      done(lookup);
    }, 20),
  );
}

function walk(node: Node, parent: Node | null, id: string | undefined): { node: Node; parent: Node | null } | undefined {
  if (id !== undefined && node.props?.id === id) return { node, parent };
  for (const child of node.children ?? []) {
    if (typeof child === "string") continue;
    const found = walk(child, node, id);
    if (found) return found;
  }
  return undefined;
}

const saving = openChooser(chooserRequest("save", { currentName: "notes.txt" }), undefined, { watch: false });
afterAll(() => saving.stop());
const sheet = () => tree(<ChooserSheet model={saving} title="Save As" exists={() => false} answer={() => {}} />);

test("the Save as field takes the row's room, at least 160 wide, and its label keeps to one line", async () => {
  const find = await sheet();
  const box = find("chooser:name-box");
  expect(box.node.props).toMatchObject({ flex: 1, minWidth: 160, direction: "row" });
  expect(find("chooser:name").parent).toBe(box.node);
  // The label is the row's first part: a box that never shrinks, its text on one line.
  const label = box.parent?.children?.[0] as Node;
  expect(label.props).toMatchObject({ shrink: false });
  expect(label.children?.[0]).toMatchObject({ type: "text", props: { truncate: true }, children: ["Save as"] });
});
