// One notification card (NO-1, NO-2; SH-34, CD-29): the banner is radius 12 with shadow lg, its app's icon 28 at
// radius 7, and its actions the kit's small Buttons, named for screen readers.
import { expect, test } from "bun:test";
import { type NativeTransport, render } from "@mirinjs/metal";
import { Banner } from "../src/notifications/lib/banner.tsx";
import { NOTE_CARD } from "../src/notifications/lib/card.tsx";
import { NotificationStore } from "../src/notifications/store.ts";
import { settle } from "./support/time.ts";

interface Node {
  props?: Record<string, unknown>;
  children?: Node[];
}

const all = (node: Node): Node[] => [node, ...(node.children ?? []).flatMap(all)];

test("a banner is the one card: radius 12, shadow lg, a 28 icon at radius 7, its actions small kit Buttons", async () => {
  const store = new NotificationStore({ schedule: () => () => {} });
  const id = store.notify({
    appName: "Mail",
    appIcon: "",
    summary: "Alex Kim",
    body: "Lunch at one?",
    actions: [
      { key: "default", label: "" },
      { key: "reply", label: "Reply" },
    ],
    urgency: "normal",
    expireTimeout: -1,
    imagePath: "",
    desktopEntry: "",
    category: "",
    transient: false,
    resident: false,
  });
  const trees: string[] = [];
  const transport: NativeTransport = { send: (tree) => trees.push(tree), onEvent() {}, onClose() {}, simulate() {}, close() {} };
  const root = render(<Banner store={store} id={id} />, transport);
  await settle();
  const nodes = all(JSON.parse(trees.at(-1) ?? "{}") as Node);
  const byTest = (testID: string) => nodes.find((node) => node.props?.id === root.nodeId(testID));
  expect(byTest("banner")?.props).toMatchObject({ cornerRadius: NOTE_CARD.radius, shadow: "lg" });
  expect(NOTE_CARD).toMatchObject({ radius: 12, padding: 12, icon: 28, iconRadius: 7 });
  expect(nodes.some((node) => node.props?.width === 28 && node.props?.cornerRadius === 7)).toBe(true);
  expect(byTest("banner-action:reply")?.props).toMatchObject({ height: 24, focusable: true, access: { role: "button", label: "Reply" } });
  root.unmount();
});
