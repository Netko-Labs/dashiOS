/**
 * A press on the lock screen asks for the password, says what it will open,
 * and opens exactly that once the password is in (pass 49 pressed a card
 * and nothing opened: the row under the clock had no press at all, and the
 * cards without an app of their own had nothing to open).
 */

import { afterEach, beforeEach, expect, test } from "bun:test";
import { type NativeEvent, type NativeRoot, type NativeTransport, render } from "@mirinjs/metal";
import { LockScreen } from "../src/lock/lib/screen.tsx";
import { lockOpenerOf, setWidgetHub, WidgetHub } from "../src/widgets/index.ts";
import { settle } from "./support/time.ts";

let root: NativeRoot;
let listeners: ((event: NativeEvent) => void)[] = [];
let trees: string[] = [];
let areas = 0;

beforeEach(async () => {
  listeners = [];
  trees = [];
  areas = 0;
  setWidgetHub(new WidgetHub({ notify() {}, live: false, openArea: () => areas++ }));
  const transport: NativeTransport = {
    send: (tree) => trees.push(tree),
    onEvent: (listener) => listeners.push(listener),
    onClose() {},
    simulate() {},
    close() {},
  };
  root = render(<LockScreen name="Alex Kim" onSubmit={async (password) => (password === "right" ? "right" : "wrong")} waitMs={() => 0} />, transport);
  await settle();
  // The host lays the screen out: a laptop's, so Today is a pane at the right.
  await emit({ type: "resize", nodeId: node("login-screen"), bounds: { x: 0, y: 0, width: 1646, height: 1029 } });
});
afterEach(() => {
  root.unmount();
  setWidgetHub(null);
});

const emit = async (event: NativeEvent): Promise<void> => {
  for (const listener of listeners) listener(event);
  await settle();
};
const node = (testID: string): string => {
  const found = root.nodeId(testID);
  if (!found) throw new Error(`no node ${testID}`);
  return found;
};
/** The password field: the one text input on the lock screen. */
const field = (): string => /"type":"input","props":\{"id":"([^"]+)"/.exec(trees.at(-1) ?? "")?.[1] ?? "";
const typePassword = async (password: string) => {
  await emit({ type: "change", nodeId: field(), value: password } as NativeEvent);
  await emit({ type: "submit", nodeId: field(), value: password } as NativeEvent);
};

test("a card on Today asks for the password, then opens Notifications", async () => {
  await emit({ type: "press", nodeId: node("lock-widget:weather") } as NativeEvent);
  expect(trees.at(-1)).toContain("Unlock to open Weather in Notifications");
  await typePassword("wrong");
  expect(areas).toBe(0);
  await typePassword("right");
  expect(areas).toBe(1);
});

test("nothing opens without a press first", async () => {
  await typePassword("right");
  expect(areas).toBe(0);
});

test("a card with an app of its own opens that app; the rest open the area", () => {
  expect(lockOpenerOf({ kind: "notes" }, () => {}).where).toBe("app");
  expect(lockOpenerOf({ kind: "battery" }, () => {}).where).toBe("app");
  expect(lockOpenerOf({ kind: "media" }, () => {}).where).toBe("area");
  expect(lockOpenerOf({ kind: "weather" }, () => {}).where).toBe("area");
});

test("on a short vertical screen Today is a peek, and its chevron opens it with no password (lock-v3 #narrow, D806)", async () => {
  await emit({ type: "resize", nodeId: node("login-screen"), bounds: { x: 0, y: 0, width: 686, height: 1097 } });
  expect(root.nodeId("lock-widget:calendar")).toBeUndefined();
  await emit({ type: "press", nodeId: node("lock-today-open") } as NativeEvent);
  expect(root.nodeId("lock-widget:calendar")).toBeDefined();
  expect(trees.at(-1)).not.toContain("Unlock to open");
  await emit({ type: "press", nodeId: node("lock-today-close") } as NativeEvent);
  expect(root.nodeId("lock-widget:calendar")).toBeUndefined();
});

test("on a tall vertical screen Today is open and stays open: no chevron", async () => {
  await emit({ type: "resize", nodeId: node("login-screen"), bounds: { x: 0, y: 0, width: 1080, height: 1920 } });
  expect(root.nodeId("lock-widget:calendar")).toBeDefined();
  expect(root.nodeId("lock-today-open")).toBeUndefined();
});
