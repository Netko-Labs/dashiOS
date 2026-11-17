/**
 * Glance on the real lock screen (pass 50 saw the lock untouched for 80 s
 * and no Glance: the lock screen's root was two views, the login screen and
 * Glance, and Metal draws only a tree's first root).
 */

import { afterEach, expect, test } from "bun:test";
import { type NativeEvent, type NativeRoot, type NativeTransport, render } from "@mirinjs/metal";
import { GLANCE_AFTER_MS } from "../src/lock/lib/rest.ts";
import { LockScreen } from "../src/lock/lib/screen.tsx";
import { setWidgetHub, WidgetHub } from "../src/widgets/index.ts";
import { fakeClockEachTest, settle } from "./support/time.ts";

const clock = fakeClockEachTest();
let root: NativeRoot | null = null;
afterEach(() => {
  root?.unmount();
  setWidgetHub(null);
});

test("untouched, the lock screen rests into Glance, and it is drawn; a press wakes it", async () => {
  setWidgetHub(new WidgetHub({ notify() {}, live: false }));
  const trees: string[] = [];
  const listeners: ((event: NativeEvent) => void)[] = [];
  const transport: NativeTransport = {
    send: (tree) => trees.push(tree),
    onEvent: (listener) => listeners.push(listener),
    onClose() {},
    simulate() {},
    close() {},
  };
  root = render(<LockScreen name="Alex Kim" onSubmit={async () => "wrong"} waitMs={() => 0} />, transport);
  await settle();
  expect(root.nodeId("glance")).toBeUndefined();
  clock.advance(GLANCE_AFTER_MS + 1000);
  await settle();
  const glance = root.nodeId("glance");
  expect(glance).toBeDefined();
  // In the tree the host draws, not only in React's.
  expect(trees.at(-1)).toContain(`"id":"${glance}"`);
  for (const listener of listeners) listener({ type: "press", nodeId: glance ?? "" } as NativeEvent);
  await settle();
  expect(root.nodeId("glance")).toBeUndefined();
});
