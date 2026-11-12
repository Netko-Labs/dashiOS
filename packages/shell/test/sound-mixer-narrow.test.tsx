/**
 * Settings › Sound in a narrow window (settings-app/lib/panes/sound-mixer-parts.tsx): a stream's slider goes
 * under its title, and must read as that title's, not as the next one's.
 */

import { expect, test } from "bun:test";
import { type NativeEvent, type NativeTransport, render, View } from "@mirinjs/metal";
import { APPS_CARD, StreamRow, streamSpacing, streamWrapped } from "../src/settings-app/lib/panes/sound-mixer-parts.tsx";
import type { StreamSound } from "../src/sound/index.ts";
import { settle } from "./support/time.ts";

interface Node {
  props: Record<string, unknown>;
  children?: unknown[];
}
const isNode = (child: unknown): child is Node => typeof child === "object" && child !== null && "props" in child;
function find(node: Node, id: string): Node | undefined {
  if (node.props.id === id) return node;
  for (const child of node.children ?? []) {
    const found = isNode(child) ? find(child, id) : undefined;
    if (found) return found;
  }
  return undefined;
}

test("a wrapped stream's slider is tied to its own title: more than twice the space under it than over it", () => {
  const wrapped = streamSpacing(true);
  const line = streamSpacing(false);
  // On one line nothing changed: no room above, 6 between and under.
  expect(line).toEqual({ paddingTop: 0, rowGap: 6, paddingBottom: 6 });
  // Over the slider: the gap to its title's line. Under it: its row's end, then the next title's room above.
  expect(wrapped.paddingBottom + wrapped.paddingTop).toBeGreaterThanOrEqual(2 * (wrapped.rowGap + APPS_CARD.line / 2));
  expect(wrapped.rowGap).toBeLessThan(line.rowGap);
});

test("the row's height says whether it wrapped, and its own spacing never flips the answer", () => {
  const controls = APPS_CARD.mute;
  // One line, with either spacing.
  expect(streamWrapped(APPS_CARD.stream)).toBe(false);
  expect(streamWrapped(streamSpacing(true).paddingTop + controls + streamSpacing(true).paddingBottom)).toBe(false);
  // Two lines (the words' 36, then the controls), with either spacing.
  for (const spacing of [streamSpacing(false), streamSpacing(true)])
    expect(streamWrapped(spacing.paddingTop + 36 + spacing.rowGap + controls + spacing.paddingBottom)).toBe(true);
});

test("a stream's row takes the tied spacing when it is laid out taller than one line, and gives it back", async () => {
  const trees: string[] = [];
  const listeners: ((event: NativeEvent) => void)[] = [];
  const transport: NativeTransport = {
    send: (sent) => trees.push(sent),
    onEvent: (listener) => listeners.push(listener),
    onClose() {},
    simulate() {},
    close() {},
  };
  const part: StreamSound = { id: 84, title: "Music", level: 0.4, muted: false, playing: true, meter: 84 };
  const root = render(
    <View>
      <StreamRow testID="stream" app="Arcade" part={part} meters={undefined} onLevel={() => {}} onMute={() => {}} />
    </View>,
    transport,
  );
  await settle();
  const laid = async (height: number): Promise<Record<string, unknown>> => {
    const nodeId = root.nodeId("stream");
    if (!nodeId) throw new Error("no stream row");
    for (const listener of listeners) listener({ type: "resize", nodeId, bounds: { x: 0, y: 0, width: 400, height } });
    await settle();
    return find(JSON.parse(trees.at(-1) ?? "{}") as Node, nodeId)?.props ?? {};
  };
  expect(await laid(84)).toMatchObject({ paddingTop: APPS_CARD.apart });
  expect((await laid(APPS_CARD.stream)).paddingTop ?? 0).toBe(0);
  root.unmount();
});
