/**
 * The menu bar's voice chip (src/voice/chip.tsx): what it says and what is still to come sit side by side,
 * each in a box that keeps its own width. Without the box two one-line texts each take half the chip
 * (mirin's `render::one_line_tests`), and a short line was drawn "can r…" with room to spare.
 */

import { expect, test } from "bun:test";
import { type NativeTransport, render } from "@mirinjs/metal";
import { type ChipSource, VoiceChip } from "../src/voice/chip.tsx";
import type { Chip } from "../src/voice/types.ts";
import { settle } from "./support/time.ts";

interface Node {
  type: string;
  props: Record<string, unknown>;
  children?: unknown[];
}
const isNode = (child: unknown): child is Node => typeof child === "object" && child !== null && "props" in child;

/** Every one-line text of the tree, with the node that holds it. */
function lines(node: Node, out: Array<{ words: string; box: Node }> = []): Array<{ words: string; box: Node }> {
  for (const child of node.children ?? []) {
    if (!isNode(child)) continue;
    if (child.type === "text" && child.props.truncate === true) out.push({ words: (child.children ?? []).join(""), box: node });
    lines(child, out);
  }
  return out;
}

function source(chip: Chip): ChipSource {
  return {
    subscribe: () => () => {},
    getSnapshot: () => chip,
    level: { subscribe: () => () => {}, getSnapshot: () => 0 },
    stop() {},
    go() {},
  };
}

async function drawn(chip: Chip): Promise<Array<{ words: string; box: Node }>> {
  const trees: string[] = [];
  const transport: NativeTransport = { send: (sent) => trees.push(sent), onEvent() {}, onClose() {}, simulate() {}, close() {} };
  const root = render(<VoiceChip voice={source(chip)} bar={1200} menus={300} status={300} />, transport);
  await settle();
  root.unmount();
  return lines(JSON.parse(trees.at(-1) ?? "{}") as Node);
}

test("what is said and what is to come each keep their own width, side by side", async () => {
  const words = ["Dashi", "can", "read", "your", "mail."];
  const shown = await drawn({ kind: "speaking", words, at: 1, full: words.join(" ") });
  expect(shown.map((line) => line.words)).toEqual(["Dashi can", "read your mail."]);
  for (const line of shown) {
    // The box holds the line alone and never shrinks: the line is as wide as its words.
    expect(line.box.props.shrink).toBe(false);
    expect(line.box.children?.filter(isNode)).toHaveLength(1);
  }
});

test("every state's words are in such a box", async () => {
  const chips: Chip[] = [
    { kind: "listening", text: "what's the weather", question: false },
    { kind: "thinking", text: "what's the weather" },
    { kind: "notice", text: "Voice needs its models. See Settings › Voice.", go: "voice" },
  ];
  for (const chip of chips) {
    const shown = await drawn(chip);
    expect(shown).toHaveLength(1);
    expect(shown[0]?.box.props.shrink).toBe(false);
  }
});
