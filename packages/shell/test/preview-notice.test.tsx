// Preview says what happened in a notice over the content's foot, never a sheet (VS-3, PA-6): a failure in ume until
// dismissed, a note that fades, and Move to Trash's "Moved … to the Trash." with Undo (PA-1, PA-2), which stays.
import { expect, test } from "bun:test";
import { type NativeEvent, type NativeTransport, render, View } from "@mirinjs/metal";
import { useEffect } from "react";
import { NOTICE_FADE_MS, type Notices, useNotices } from "../apps/preview/lib/hooks/use-notice.ts";
import { noticeView } from "../apps/preview/lib/views/notice.tsx";
import { fakeClockEachTest } from "./support/time.ts";

const clock = fakeClockEachTest();

function mount() {
  const listeners: ((event: NativeEvent) => void)[] = [];
  const trees: string[] = [];
  const transport: NativeTransport = {
    send: (tree) => trees.push(tree),
    onEvent: (listener) => listeners.push(listener),
    onClose() {},
    simulate() {},
    close() {},
  };
  let notices: Notices | null = null;
  function Host() {
    const now = useNotices();
    useEffect(() => {
      notices = now;
    });
    return <View testID="host">{noticeView(now)}</View>;
  }
  const root = render(<Host />, transport);
  const press = (testID: string): void => {
    const nodeId = root.nodeId(testID);
    if (!nodeId) throw new Error(`no node ${testID}`);
    for (const listener of listeners) listener({ type: "press", nodeId });
  };
  const say: Notices["say"] = (...args) => {
    if (!notices) throw new Error("not mounted");
    notices.say(...args);
  };
  return { root, press, say, last: () => trees.at(-1) ?? "" };
}

test("a failure stays until it is dismissed; a note fades", async () => {
  const { root, press, say, last } = mount();
  await clock.advance(0);
  say("Not printed. The printer didn’t take it.");
  await clock.advance(NOTICE_FADE_MS * 2);
  expect(last()).toContain("Not printed.");
  press("notice:close");
  await clock.advance(0);
  expect(last()).not.toContain("Not printed.");
  say("Exported without the rotation.", "info");
  await clock.advance(0);
  expect(last()).toContain("Exported without the rotation.");
  await clock.advance(NOTICE_FADE_MS);
  expect(last()).not.toContain("Exported without the rotation.");
  root.unmount();
});

test("Move to Trash's notice keeps its Undo until it is used, and Undo takes the step back", async () => {
  const { root, press, say, last } = mount();
  await clock.advance(0);
  let undone = 0;
  say("Moved “a.png” to the Trash.", "info", () => undone++);
  await clock.advance(NOTICE_FADE_MS * 2);
  expect(last()).toContain("Moved “a.png” to the Trash.");
  press("notice:undo");
  await clock.advance(0);
  expect(undone).toBe(1);
  expect(last()).not.toContain("Moved “a.png”");
  root.unmount();
});
