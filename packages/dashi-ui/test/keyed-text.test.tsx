import { expect, test } from "bun:test";
import { render } from "@mirinjs/metal";
import { KeyedText, keyGlyphSize, namesKeys } from "../src/keyed-text.tsx";
import { fakeHost } from "./host.ts";
import { settle } from "./support/time.ts";

// 04-night's smoke pass: ❖ and ⌥ inside a sentence were drawn by the font the host falls back to, at half the size of the words.

interface Drawn {
  type: string;
  props: Record<string, unknown>;
  children?: Drawn[];
}

const drawn = async (element: React.ReactElement): Promise<Drawn> => {
  const host = fakeHost();
  const root = render(element, host.transport);
  await settle();
  const tree = JSON.parse(host.last()) as Drawn;
  root.unmount();
  return tree;
};

test("a sentence that names a key draws the key's glyph at the size of its text, against its word", async () => {
  const tree = await drawn(<KeyedText style={{ fontSize: 12, color: "#000000" }}>Hold ❖Space or the right ⌥ key to talk.</KeyedText>);
  expect(tree.props.access).toEqual({ label: "Hold ❖Space or the right ⌥ key to talk." });
  expect(tree.props.wrap).toBe(true);
  const kids = tree.children ?? [];
  // Hold | ❖Space | or | the | right | ⌥ | key | to | talk.
  expect(kids.map((kid) => kid.type)).toEqual(["text", "view", "text", "text", "text", "view", "text", "text", "text"]);
  const [glyph, word] = kids[1]?.children ?? [];
  expect([glyph?.type, word?.type]).toEqual(["svg", "text"]);
  // The glyph's box is the text's size and a little: never the half-size a fallback font gave.
  expect(glyph?.props.size).toBe(keyGlyphSize(12));
  expect(keyGlyphSize(12)).toBeGreaterThanOrEqual(12);
  expect(kids[5]?.children?.map((kid) => kid.type)).toEqual(["svg"]);
});

test("a sentence with no key is one plain text, and one line stays one line", async () => {
  expect(namesKeys("Hold Caps Lock to dictate.")).toBe(false);
  expect(namesKeys("the right ⌥")).toBe(true);
  expect((await drawn(<KeyedText style={{ fontSize: 12, color: "#000000" }}>Hold Caps Lock to dictate.</KeyedText>)).type).toBe("text");
  const line = await drawn(
    <KeyedText oneLine style={{ fontSize: 12, color: "#000000" }}>
      Hold ❖Space to talk.
    </KeyedText>,
  );
  expect(line.type).toBe("view");
  expect(line.props.wrap ?? false).toBe(false);
});
