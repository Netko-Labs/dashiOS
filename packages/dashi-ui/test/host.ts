import type { NativeEvent, NativeTransport } from "@mirinjs/metal";
import { settle } from "./support/time.ts";

export { settle };

/** A stand-in for the Metal host: the trees it was sent, and events sent back as the host would. */
export function fakeHost(): { transport: NativeTransport; trees: string[]; emit: (event: NativeEvent) => void; last: () => string } {
  const trees: string[] = [];
  const listeners: ((event: NativeEvent) => void)[] = [];
  const transport: NativeTransport = {
    send: (tree) => trees.push(tree),
    onEvent: (listener) => listeners.push(listener),
    onClose() {},
    simulate() {},
    close() {},
  };
  const emit = (event: NativeEvent): void => {
    for (const listener of listeners) listener(event);
  };
  return { transport, trees, emit, last: () => trees.at(-1) ?? "" };
}
