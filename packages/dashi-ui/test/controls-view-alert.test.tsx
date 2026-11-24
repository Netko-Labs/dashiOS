import { expect, test } from "bun:test";
import { render, View } from "@mirinjs/metal";
import { type AlertButton, AlertSheet, AlertWindow, alertKeyTarget } from "../src/alert.tsx";
import { WARNING } from "../src/glyphs.ts";
import { fakeHost } from "./host.ts";
import { noop, windowKey } from "./support/controls-view.ts";
import { fakeClockEachTest, settle } from "./support/time.ts";

fakeClockEachTest();

test("Esc presses the cancel button and Enter the default one; a grant is never Enter's", () => {
  const cancel: AlertButton = { label: "Cancel", testID: "c", onPress: noop, cancel: true };
  const go: AlertButton = { label: "Go", testID: "g", onPress: noop, kind: "primary" };
  expect(alertKeyTarget({ kind: "escape" }, [cancel, go])).toBe(cancel);
  expect(alertKeyTarget({ kind: "enter" }, [cancel, go])).toBe(go);
  // Destroying: Cancel is the default, so Enter cancels too.
  const safe = { ...cancel, isDefault: true };
  expect(alertKeyTarget({ kind: "enter" }, [safe, { ...go, kind: "danger" }])).toBe(safe);
  // A grant: only a click.
  expect(alertKeyTarget({ kind: "enter" }, [cancel, { ...go, isDefault: false }])).toBeNull();
  // A disabled default is no default.
  expect(alertKeyTarget({ kind: "enter" }, [cancel, { ...go, disabled: true }])).toBeNull();
  // A message that only informs: its one button is both.
  const ok: AlertButton = { label: "OK", testID: "ok", onPress: noop, kind: "primary" };
  expect(alertKeyTarget({ kind: "escape" }, [ok])).toBe(ok);
  expect(alertKeyTarget({ kind: "enter" }, [ok])).toBe(ok);
  expect(alertKeyTarget({ kind: "text", text: "y" }, [ok])).toBeNull();
});

test("an alert sheet answers Esc and Enter through its buttons", async () => {
  const host = fakeHost();
  const pressed: string[] = [];
  const root = render(
    <AlertSheet
      testID="ask"
      question="That didn’t work"
      message="The file is gone."
      glyph={WARNING}
      buttons={[{ label: "OK", testID: "ask:ok", onPress: () => pressed.push("ok"), kind: "primary" }]}
    />,
    host.transport,
  );
  await settle();
  const keys = root.nodeId("ask:keys") as string;
  host.emit(windowKey(keys, "escape"));
  host.emit(windowKey(keys, "enter"));
  expect(pressed).toEqual(["ok", "ok"]);
  expect(host.last()).toContain("That didn’t work");
  root.unmount();
});

test("an alert window draws the question as its first line, with no title row", async () => {
  const host = fakeHost();
  const pressed: string[] = [];
  const root = render(
    <AlertWindow
      testID="w"
      question="Use the camera?"
      glyph={WARNING}
      buttons={[
        { label: "Don’t Allow", testID: "w:deny", onPress: () => pressed.push("deny"), cancel: true },
        { label: "Allow", testID: "w:allow", onPress: () => pressed.push("allow"), kind: "primary", isDefault: false },
      ]}
    />,
    host.transport,
  );
  host.emit({ type: "chrome", nodeId: "root", titleBar: "unified", controls: { x: 8, y: 8, width: 60, height: 22 } });
  await settle();
  expect(root.nodeId("window-toolbar")).toBeUndefined();
  const keys = root.nodeId("w:keys") as string;
  host.emit(windowKey(keys, "enter"));
  host.emit(windowKey(keys, "escape"));
  expect(pressed).toEqual(["deny"]);
  root.unmount();
});

test("on a shell surface the sheet is centred with no scrim; its tile may be the asker's own picture", async () => {
  const host = fakeHost();
  const root = render(
    <AlertSheet
      testID="s"
      place="screen"
      question="Log out now?"
      glyph={WARNING}
      icon={<View testID="s:icon" />}
      buttons={[{ label: "Log out", testID: "s:go", onPress: noop, kind: "primary" }]}
    />,
    host.transport,
  );
  await settle();
  expect(root.nodeId("s:scrim")).toBeUndefined();
  expect(root.nodeId("s:place")).toBeDefined();
  expect(root.nodeId("s:icon")).toBeDefined();
  expect(host.last()).not.toContain(WARNING);
  expect(root.nodeId("s:keys")).toBeDefined();
  root.unmount();
});

test("a sheet that never takes the keyboard by itself has no keys of its own; its buttons still answer", async () => {
  const host = fakeHost();
  const pressed: string[] = [];
  const root = render(
    <AlertSheet
      testID="k"
      place="screen"
      keys={false}
      question="Allow it?"
      glyph={WARNING}
      buttons={[
        { label: "Don’t allow", testID: "k:no", onPress: () => pressed.push("no"), cancel: true },
        { label: "Allow once", testID: "k:yes", onPress: () => pressed.push("yes"), kind: "primary" },
      ]}
    />,
    host.transport,
  );
  await settle();
  expect(root.nodeId("k:keys")).toBeUndefined();
  host.emit({ type: "press", nodeId: root.nodeId("k:yes") as string });
  await settle();
  expect(pressed).toEqual(["yes"]);
  root.unmount();
});
