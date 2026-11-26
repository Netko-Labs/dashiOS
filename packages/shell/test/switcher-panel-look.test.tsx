// The switcher's chosen app is a selection (CO-9, SH-12): the selection's wash on the whole tile, named for
// screen readers; the panel is regular glass, 14 (RA-2, DE-4, D781): on its glass the wash is the accent at 22 %.
import { expect, test } from "bun:test";
import { GLASS, lightColors, paintedPalette } from "@dashi/ui";
import { type NativeTransport, render } from "@mirinjs/metal";
import { SwitcherPanel, SwitcherStore } from "../src/switcher/panel.tsx";
import { settle } from "./support/time.ts";

interface Node {
  props?: Record<string, unknown>;
  children?: Node[];
}
const all = (node: Node): Node[] => [node, ...(node.children ?? []).flatMap(all)];

test("the chosen app sits on the selection's wash, the others on nothing; the panel is regular glass, 14", async () => {
  const store = new SwitcherStore();
  const apps = [
    { appId: "files", title: "Files", count: 1, away: false },
    { appId: "notes", title: "Notes", count: 2, away: false },
  ];
  store.set({ selected: 1, apps, windows: null, windowStart: 0, selectedWindow: null, query: "", size: { width: 1200, height: 800 } });
  const trees: string[] = [];
  const transport: NativeTransport = { send: (tree) => trees.push(tree), onEvent() {}, onClose() {}, simulate() {}, close() {} };
  const root = render(<SwitcherPanel store={store} identify={(app) => ({ name: app.appId, icon: "" })} />, transport);
  await settle();
  const nodes = all(JSON.parse(trees.at(-1) ?? "{}") as Node);
  const byTest = (testID: string) => nodes.find((node) => node.props?.id === root.nodeId(testID));
  const onGlass = paintedPalette(lightColors, false, { level: "regular", tone: null }, true);
  expect(byTest("switcher-app-1")?.props).toMatchObject({ background: onGlass.selectionWash, access: { role: "option", label: "notes", selected: true } });
  expect(String(byTest("switcher-app-0")?.props?.background ?? "#00000000")).toBe("#00000000");
  expect(byTest("switcher-panel")?.props).toMatchObject({ cornerRadius: 14, shadow: "xl", background: GLASS.levels.regular.light.solid });
  root.unmount();
});
