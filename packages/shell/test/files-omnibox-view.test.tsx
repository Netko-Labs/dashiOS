import { expect, test } from "bun:test";
import { type NativeEvent, type NativeTransport, render } from "@mirinjs/metal";
import { Omnibox } from "../apps/files/lib/omnibox/omnibox.tsx";
import { Files, type FilesContext } from "../src/shared/file-browser/context.ts";
import { settle } from "./support/time.ts";

// Files' path bar is the toolbar's first Tab stop at rest (KB-1): Space or
// Return on it makes it text, as a click on its empty part does.

test("the omnibox at rest is a Tab stop, and pressing it starts a search", async () => {
  const state = { location: { kind: "folder", path: "/home/alexk/Documents" }, selection: [], query: "", free: null };
  const store = {
    env: { home: "/home/alexk", trash: { files: "/home/alexk/.local/share/Trash/files" } },
    subscribe: () => () => {},
    getSnapshot: () => state,
    visible: () => [],
  };
  const files = { store, ops: {}, actions: {} } as unknown as FilesContext;
  const trees: string[] = [];
  const listeners: ((event: NativeEvent) => void)[] = [];
  const transport: NativeTransport = {
    send: (tree) => trees.push(tree),
    onEvent: (listener) => listeners.push(listener),
    onClose() {},
    simulate() {},
    close() {},
  };
  const edits: string[] = [];
  const root = render(
    <Files.Provider value={files}>
      <Omnibox editing={null} onEdit={(text) => edits.push(text)} onDone={() => {}} onSuggest={() => {}} />
    </Files.Provider>,
    transport,
  );
  await settle();
  const tree = JSON.parse(trees.at(-1) ?? "{}") as { props: Record<string, unknown> };
  expect(tree.props).toMatchObject({ id: root.nodeId("omnibox"), focusable: true, onPress: true });
  // Space or Return on the focused box is a press with no modifiers.
  const nodeId = root.nodeId("omnibox") ?? "";
  for (const listener of listeners) listener({ type: "press", nodeId });
  expect(edits).toEqual([""]);
  root.unmount();
});
