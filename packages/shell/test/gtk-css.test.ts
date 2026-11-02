import { expect, test } from "bun:test";

import { BEGIN, END, withBlock } from "../src/appearance/gtk-css.ts";

test("a file a crash zero-filled gets its NUL bytes dropped, not kept forever", () => {
  const broken = `${"\0".repeat(64)}\n\n${BEGIN}\nold\n${END}\n`;
  const fixed = withBlock(broken, `${BEGIN}\nnew\n${END}`);
  expect(fixed).not.toContain("\0");
  expect(fixed).toBe(`${BEGIN}\nnew\n${END}\n`);
});

test("the person's own CSS stays, before Dashi's block", () => {
  expect(withBlock("window { color: red; }\n", `${BEGIN}\nx\n${END}`)).toBe(`window { color: red; }\n\n${BEGIN}\nx\n${END}\n`);
});
