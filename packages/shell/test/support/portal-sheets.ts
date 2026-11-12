// The portal's sheets on a stand-in for the Metal host, with input sent back the way the host sends it.

import { type NativeEvent, type NativeRoot, type NativeTransport, render } from "@mirinjs/metal";
import type { ReactElement } from "react";
import type { ShowDialog } from "../../apps/portal/lib/windows.ts";

interface Mounted {
  root: NativeRoot;
  send: (event: NativeEvent) => void;
  node: (testID: string) => string;
}

export function mount(element: ReactElement): Mounted {
  const listeners: ((event: NativeEvent) => void)[] = [];
  const transport: NativeTransport = { send() {}, onEvent: (listener) => listeners.push(listener), onClose() {}, simulate() {}, close() {} };
  const root = render(element, transport);
  const node = (testID: string): string => {
    const id = root.nodeId(testID);
    if (!id) throw new Error(`no node ${testID}`);
    return id;
  };
  const send = (event: NativeEvent): void => {
    for (const listener of listeners) listener(event);
  };
  return { root, node, send };
}

/** A ShowDialog that mounts the sheet here and hands back its answer. */
export function showHere(): { show: ShowDialog; mounted: () => Mounted } {
  let current: Mounted | null = null;
  const show: ShowDialog = <T>(_window: unknown, build: (answer: (value: T) => void) => ReactElement) =>
    new Promise<T>((resolve) => {
      current = mount(build(resolve));
    });
  return {
    show,
    mounted: () => {
      if (!current) throw new Error("nothing shown");
      return current;
    },
  };
}
