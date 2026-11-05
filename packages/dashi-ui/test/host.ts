import type { NativeEvent, NativeTransport } from "@mirinjs/metal";

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

export const settle = (ms = 20): Promise<void> => new Promise((done) => setTimeout(done, ms));
