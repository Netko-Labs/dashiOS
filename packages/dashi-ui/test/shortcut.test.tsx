import { expect, test } from "bun:test";
import { render } from "@mirinjs/metal";
import { Shortcut } from "../src/shortcut.tsx";
import { fakeHost, settle } from "./host.ts";

// Review 54 (Activity Monitor 18): a menu's "❖I" read as "❖ I", the glyph's own side room plus a gap.
// The parts of a shortcut sit with no gap between them.

interface Drawn {
  type: string;
  props: Record<string, unknown>;
  children?: unknown[];
}

test("a shortcut's glyph and key sit with no gap between them", async () => {
  const host = fakeHost();
  const root = render(<Shortcut keys="❖I" color="#000000" />, host.transport);
  await settle();
  const tree = JSON.parse(host.last()) as Drawn;
  const kids = (tree.children ?? []) as Drawn[];
  expect(kids.map((kid) => kid.type)).toEqual(["svg", "text"]);
  expect(tree.props.gap ?? 0).toBe(0);
  root.unmount();
});
