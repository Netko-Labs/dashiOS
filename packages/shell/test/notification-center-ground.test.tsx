import { expect, test } from "bun:test";
import { type NativeTransport, render, View } from "@mirinjs/metal";
import { NotificationCenterPanel } from "../src/notifications/center.tsx";
import { NotificationStore } from "../src/notifications/store.ts";
import { settle } from "./support/time.ts";

// 0.6: the center painted the menus' 97% tint, so the window under its empty half ghosted through.
test("the notification center is solid, with the menus' edge", async () => {
  const trees: string[] = [];
  const transport: NativeTransport = { send: (tree) => trees.push(tree), onEvent() {}, onClose() {}, simulate() {}, close() {} };
  // In a view, as the popover surface draws it: the panel is a fragment (its key catcher, then the panel).
  const root = render(
    <View style={{ flex: 1 }}>
      <NotificationCenterPanel store={new NotificationStore()} onClose={() => {}} dockInset={0} />
    </View>,
    transport,
  );
  await settle();
  const backgrounds = [...(trees.at(-1) ?? "").matchAll(/"background":"(#[0-9a-fA-F]+)"/g)].map((match) => match[1] ?? "");
  // The panel is the first ground drawn: six hex digits, no alpha.
  const panel = backgrounds.find((color) => color.toLowerCase().startsWith("#f6f6f8"));
  expect(panel).toBe("#f6f6f8");
  root.unmount();
});
