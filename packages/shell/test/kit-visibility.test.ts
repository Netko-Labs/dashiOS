import { expect, test } from "bun:test";
import type { NativeEvent } from "@mirinjs/metal";
import { onWindowVisibility } from "../apps/kit/visibility.ts";

test("the window's visibility reaches the app once per change", () => {
  const listeners: ((event: NativeEvent) => void)[] = [];
  const host = { onEvent: (listener: (event: NativeEvent) => void) => listeners.push(listener) };
  const seen: boolean[] = [];
  onWindowVisibility(host, (visible) => seen.push(visible));
  const emit = (event: NativeEvent): void => {
    for (const listener of listeners) listener(event);
  };
  // A window opens seen: being told so again changes nothing.
  emit({ type: "visibility", nodeId: "root", visible: true });
  emit({ type: "visibility", nodeId: "root", visible: false });
  emit({ type: "visibility", nodeId: "root", visible: false });
  emit({ type: "press", nodeId: "3" });
  emit({ type: "visibility", nodeId: "root", visible: true });
  expect(seen).toEqual([false, true]);
});
