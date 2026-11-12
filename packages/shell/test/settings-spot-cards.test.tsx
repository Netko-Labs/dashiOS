import { expect, test } from "bun:test";
import { type NativeRoot, type NativeTransport, render } from "@mirinjs/metal";
import { RowFocus, Spot, SpotContext } from "../src/settings-app/spot.tsx";
import { Caption, Group, Note } from "../src/shared/cards/index.ts";
import { LIGHT_CONTROLS } from "../src/shared/controls/palette.ts";
import { settle } from "./support/time.ts";

// A link to a section (Privacy & Security › Apps) lights its card, not the strip behind its heading.

interface Node {
  type: string;
  props?: { id?: string; background?: string };
  children?: unknown[];
}

const isNode = (value: unknown): value is Node => typeof value === "object" && value !== null && "type" in value;

/** The node with this id in a tree the host was sent. */
function byId(tree: unknown, id: string): Node | null {
  if (!isNode(tree)) return null;
  if (tree.props?.id === id) return tree;
  for (const child of tree.children ?? []) {
    const found = byId(child, id);
    if (found) return found;
  }
  return null;
}

/** Every ground painted in a subtree. */
function grounds(tree: unknown): string[] {
  if (!isNode(tree)) return [];
  return [...(tree.props?.background ? [tree.props.background] : []), ...(tree.children ?? []).flatMap(grounds)];
}

test("a section's Spot lights its card and leaves its heading alone", async () => {
  let last = "";
  const transport: NativeTransport = { send: (tree) => void (last = tree), onEvent() {}, onClose() {}, simulate() {}, close() {} };
  const focus = new RowFocus();
  const root: NativeRoot = render(
    <SpotContext.Provider value={{ focus }}>
      <Spot id="privacy/apps" cards>
        <Caption above>Apps</Caption>
        <Group testID="apps-card">
          <Note>No app has been given a permission.</Note>
        </Group>
      </Spot>
    </SpotContext.Provider>,
    transport,
  );
  await settle();
  const node = (testID: string): Node | null => byId(JSON.parse(last), root.nodeId(testID) ?? "");
  // A soft wash of the page's ink: purple is the keyboard ring's and the agents'.
  const wash = LIGHT_CONTROLS.lit;
  expect(wash.toLowerCase().startsWith(LIGHT_CONTROLS.text.toLowerCase())).toBe(true);
  expect(grounds(node("spot:apps"))).not.toContain(wash);

  focus.request("privacy", "apps");
  await settle();
  // The light is over the card's own ground, once; the Spot paints nothing behind the heading.
  expect(node("spot:apps")?.props?.background).toBeUndefined();
  expect(grounds(node("apps-card"))).toEqual([LIGHT_CONTROLS.off, wash]);
  expect(grounds(node("spot:apps")).filter((color) => color === wash)).toHaveLength(1);
  root.unmount();
});
