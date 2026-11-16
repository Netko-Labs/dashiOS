// The launcher's in-place question (pass 37, 33b): an add-on's "Get …? It can: …" ran under the ↩ key and off
// the panel. It wraps now, and the row grows with it; the key keeps its place at the right end.

import { expect, test } from "bun:test";
import { type NativeTransport, render } from "@mirinjs/metal";
import { ResultRow } from "../src/launcher/lib/row-view.tsx";
import { KEYS, type Verb, verbRow } from "../src/launcher/verbs.ts";
import { settle } from "./support/time.ts";

interface Node {
  type: string;
  props: Record<string, unknown>;
  children: (Node | string)[];
}

const ENGLISH =
  "Get “ASUS Control”? It can: Change the power mode, battery charge limit and processor boost; change the keyboard’s lights; send you notifications. Return again gets it.";
// An add-on whose own words are Spanish (its name and what it adds come from its manifest).
const SPANISH =
  "Get “Control de ASUS”? Añade 3 órdenes al lanzador: Cambiar el modo de energía, el límite de carga de la batería y el impulso del procesador. It can: Change the power mode; send you notifications. Return again gets it.";

async function drawn(verb: Verb, asking: boolean): Promise<Node> {
  const transport: NativeTransport = { send() {}, onEvent() {}, onClose() {}, simulate() {}, close() {} };
  const root = render(<ResultRow row={verbRow(verb, asking)} selected onPress={() => {}} onHover={() => {}} />, transport);
  await settle();
  const tree = JSON.parse(root.lastTree() ?? "null") as Node;
  root.unmount();
  return tree;
}

const texts = (node: Node | string): Node[] =>
  typeof node === "string" ? [] : [...(node.type === "text" ? [node] : []), ...(node.children ?? []).flatMap(texts)];

for (const [language, question] of [
  ["English", ENGLISH],
  ["Spanish", SPANISH],
] as const) {
  test(`the add-on's question wraps in a row that grows, and ↩ keeps the right end (${language})`, async () => {
    const verb: Verb = { id: "get", title: "Get", key: KEYS.primary, confirm: question, effect: { kind: "scope", verb: "get" } };
    const row = await drawn(verb, true);
    // The row grows: at least a row's height, never a fixed one.
    expect(row.props.minHeight).toBe(40);
    expect(row.props.height).toBeUndefined();
    const [title] = texts(row);
    expect(title?.children).toEqual([question]);
    // Every word is drawn: not cut to one line.
    expect(title?.props.truncate).toBeUndefined();
    // The words give way to the key; the key never gives way.
    const [, words, end] = row.children as Node[];
    expect((words?.children[0] as Node).props.shrink).toBe(true);
    expect(end?.props.shrink).toBe(false);
    expect(JSON.stringify(end)).toContain("svg");
  });
}

test("a verb that isn't asking stays one row on one line", async () => {
  const verb: Verb = { id: "get", title: "Get", key: KEYS.primary, confirm: ENGLISH, effect: { kind: "scope", verb: "get" } };
  const row = await drawn(verb, false);
  expect(row.props.height).toBe(40);
  expect(texts(row)[0]?.props.truncate).toBe(true);
  expect(verbRow(verb, false).question).toBeUndefined();
  expect(verbRow(verb, true)).toMatchObject({ title: ENGLISH, question: true });
});
