import { expect, test } from "bun:test";
import { type NativeEvent, render, View } from "@mirinjs/metal";
import { useEffect } from "react";
import { type Confirm, ConfirmSheet, confirmKeyAction, useConfirm } from "../src/confirm.tsx";
import { fakeHost, settle } from "./host.ts";

/** A key the window got, as Metal hands it to a KeySink (`onWindowKeyDown`). */
const windowKey = (nodeId: string, key: string): NativeEvent => ({
  type: "windowkey",
  nodeId,
  key,
  ctrl: false,
  alt: false,
  shift: false,
  meta: false,
  repeat: false,
});

test("Esc cancels; Enter goes ahead only when nothing is destroyed", () => {
  expect(confirmKeyAction({ kind: "escape" }, false)).toBe("cancel");
  expect(confirmKeyAction({ kind: "escape" }, true)).toBe("cancel");
  expect(confirmKeyAction({ kind: "enter" }, false)).toBe("confirm");
  expect(confirmKeyAction({ kind: "enter" }, true)).toBe("cancel");
  expect(confirmKeyAction({ kind: "text", text: "y" }, true)).toBeNull();
});

async function mount(danger: boolean) {
  const host = fakeHost();
  const answers: string[] = [];
  const root = render(
    <ConfirmSheet
      testID="ask"
      title="Delete “Groceries”?"
      message="You can't undo this."
      confirmLabel="Delete"
      danger={danger}
      onConfirm={() => answers.push("confirm")}
      onCancel={() => answers.push("cancel")}
    />,
    host.transport,
  );
  await settle();
  const keys = root.nodeId("ask:keys");
  if (!keys) throw new Error("the sheet has no keys");
  return { host, answers, root, keys };
}

test("Enter on a destructive sheet cancels, and only the ume button deletes", async () => {
  const { host, answers, root, keys } = await mount(true);
  host.emit(windowKey(keys, "enter"));
  host.emit(windowKey(keys, "escape"));
  expect(answers).toEqual(["cancel", "cancel"]);
  host.emit({ type: "press", nodeId: root.nodeId("ask:ok") as string });
  expect(answers).toEqual(["cancel", "cancel", "confirm"]);
  // The destructive button is ume's fill, and Cancel wears the default's 2 px ink edge (no kombu: nothing is on).
  expect(host.last()).toContain("#B8475C");
  expect(host.last()).toContain('"borderWidth":2,"borderColor":"#1d1d1f"');
  expect(host.last()).not.toContain("#357A64");
  root.unmount();
});

test("Enter on a safe sheet goes ahead", async () => {
  const { host, answers, root, keys } = await mount(false);
  host.emit(windowKey(keys, "enter"));
  expect(answers).toEqual(["confirm"]);
  root.unmount();
});

test("useConfirm shows the sheet on ask and clears it on an answer", async () => {
  const host = fakeHost();
  const done: string[] = [];
  let confirm: Confirm | null = null;
  function Window() {
    const asked = useConfirm();
    useEffect(() => {
      confirm = asked;
    });
    return <View>{asked.sheet}</View>;
  }
  const root = render(<Window />, host.transport);
  await settle();
  expect(host.last()).not.toContain("Home Wi-Fi");
  (confirm as Confirm | null)?.ask({
    testID: "forget",
    title: "Forget “Home Wi-Fi”?",
    message: "You'll need its password to join it again.",
    confirmLabel: "Forget",
    danger: true,
    onConfirm: () => done.push("forgot"),
    onCancel: () => done.push("kept"),
  });
  await settle();
  expect(host.last()).toContain("Forget “Home Wi-Fi”?");
  host.emit({ type: "press", nodeId: root.nodeId("forget:cancel") as string });
  await settle();
  expect(done).toEqual(["kept"]);
  expect(host.last()).not.toContain("Home Wi-Fi");
  root.unmount();
});
