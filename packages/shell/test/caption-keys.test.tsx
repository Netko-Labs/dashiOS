import { expect, test } from "bun:test";
import { type NativeTransport, render } from "@mirinjs/metal";
import { Caption } from "../src/shared/cards/index.ts";
import { settle } from "./support/time.ts";

interface Node {
  type: string;
  props: Record<string, unknown>;
  children?: unknown[];
}
const isNode = (child: unknown): child is Node => typeof child === "object" && child !== null && "props" in child;
const textOf = (node: Node): string =>
  (node.children ?? []).map((child) => (isNode(child) ? textOf(child) : String(child))).join("") + String(node.props.text ?? "");

async function sent(element: React.ReactNode): Promise<Node> {
  const trees: string[] = [];
  const transport: NativeTransport = { send: (tree) => trees.push(tree), onEvent() {}, onClose() {}, simulate() {}, close() {} };
  const root = render(element, transport);
  await settle();
  root.unmount();
  return JSON.parse(trees[0] ?? "{}") as Node;
}

test("a caption's shortcut stays after its last word when the sentence wraps", async () => {
  // Desktop & Dock at a small width: the sentence wrapped as one block and the keys sat at its right, half way up.
  const caption = await sent(<Caption keys="⌃↑">Swipe sideways with three fingers to change desktops. Overview shows them all, on</Caption>);
  expect(caption.props).toMatchObject({ direction: "row", wrap: true });
  const pieces = (caption.children ?? []).filter(isNode);
  // A piece a word, so the row breaks between any two; the last word and the keys are one piece that never breaks.
  expect(pieces.slice(0, 3).map(textOf)).toEqual(["Swipe", "sideways", "with"]);
  expect(pieces).toHaveLength(13);
  const last = pieces.at(-1);
  expect(last?.props).toMatchObject({ direction: "row", shrink: false });
  const inLast = (last?.children ?? []).filter(isNode);
  expect(textOf(inLast[0] as Node)).toBe("on");
  expect(inLast).toHaveLength(2);
});

test("a caption without keys is one text, as before", async () => {
  const caption = await sent(<Caption>The battery lasts longest kept below full.</Caption>);
  expect(caption.props.wrap).toBeUndefined();
  expect((caption.children ?? []).filter(isNode)).toHaveLength(1);
});
