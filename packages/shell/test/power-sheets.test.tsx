import { expect, test } from "bun:test";
import { Appearance } from "@dashi/ui";
import { type NativeEvent, type NativeTransport, render } from "@mirinjs/metal";
import { ConfirmSheet } from "../src/menus/lib/power-sheets.tsx";
import type { PowerKind } from "../src/menus/types.ts";
import { settle } from "./support/time.ts";

// The Log Out, Restart and Shut Down sheets: Return presses the default button, Esc cancels.

async function sheet(what: PowerKind) {
  const answers: string[] = [];
  const listeners: ((event: NativeEvent) => void)[] = [];
  const transport: NativeTransport = { send() {}, onEvent: (listener) => listeners.push(listener), onClose() {}, simulate() {}, close() {} };
  const root = render(
    <Appearance dark={false}>
      <ConfirmSheet what={what} onConfirm={() => answers.push("confirm")} onCancel={() => answers.push("cancel")} />
    </Appearance>,
    transport,
  );
  await settle();
  const emit = async (event: NativeEvent): Promise<void> => {
    for (const listener of listeners) listener(event);
    await settle();
  };
  const node = (testID: string): string => {
    const id = root.nodeId(testID);
    if (!id) throw new Error(`no node ${testID}`);
    return id;
  };
  return { answers, root, emit, node };
}

for (const what of ["logout", "restart", "shutdown"] as const) {
  test(`Return presses the ${what} sheet's default button, and Esc cancels`, async () => {
    const view = await sheet(what);
    await view.emit({ type: "submit", nodeId: view.node("sheet-keys"), value: "" });
    expect(view.answers).toEqual(["confirm"]);
    await view.emit({ type: "key", nodeId: view.node("sheet-keys"), value: "Escape" });
    expect(view.answers).toEqual(["confirm", "cancel"]);
    // The buttons still answer a click.
    await view.emit({ type: "press", nodeId: view.node("sheet-confirm") });
    await view.emit({ type: "press", nodeId: view.node("sheet-cancel") });
    expect(view.answers).toEqual(["confirm", "cancel", "confirm", "cancel"]);
    view.root.unmount();
  });
}
