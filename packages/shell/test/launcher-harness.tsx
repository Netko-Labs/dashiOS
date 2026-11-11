/**
 * The launcher mounted on a stand-in for the Metal host: typing, keys and the
 * pointer sent as the host sends them, what it draws read back from the tree.
 * Shared by the launcher's view tests; each calls `unmountLauncher` after each test.
 */

import { lightColors } from "@dashi/ui";
import { type NativeEvent, type NativeRoot, type NativeTransport, render } from "@mirinjs/metal";
import { Launcher } from "../src/launcher/launcher.tsx";
import type { LauncherFiles, LauncherProps } from "../src/launcher/props.ts";
import type { FileRow } from "../src/launcher/row-model.ts";
import type { Entry } from "../src/shared/app-entries/index.ts";
import { settle } from "./support/time.ts";

export { settle };

export const app = (name: string): Entry => ({ id: `app.${name.toLowerCase().replaceAll(" ", "-")}`, name, icon: "/icon.svg", keywords: [], exec: ["true"] });
export const file = (name: string): FileRow => ({
  url: `file:///home/alexk/${name}`,
  path: `/home/alexk/${name}`,
  name,
  folder: "~",
  mime: "text/plain",
  icon: "/file.svg",
});

interface Node {
  testID?: string;
  props?: Record<string, unknown>;
  style?: Record<string, unknown>;
  children?: Node[];
  [key: string]: unknown;
}

/** Files that answer when the test says. */
export function deferredFiles(available = true): LauncherFiles & { answer(rows: FileRow[] | null): void; asked: string[] } {
  let resolve: ((rows: FileRow[] | null) => void) | null = null;
  const asked: string[] = [];
  return {
    asked,
    isAvailable: () => available,
    find: (query) => {
      asked.push(query);
      return new Promise((done) => {
        resolve = done;
      });
    },
    answer: (rows) => resolve?.(rows),
  };
}

let mounted: NativeRoot | null = null;

/** Take the launcher of the last test down (call in `afterEach`). */
export function unmountLauncher(): void {
  mounted?.unmount();
  mounted = null;
}

export async function mount(props: Partial<LauncherProps> & Pick<LauncherProps, "entries">, candidates: readonly string[] = []) {
  const listeners: ((event: NativeEvent) => void)[] = [];
  const transport: NativeTransport = { send() {}, onEvent: (listener) => listeners.push(listener), onClose() {}, simulate() {}, close() {} };
  const opened: string[] = [];
  const closed: number[] = [];
  const root = render(
    <Launcher
      onOpen={(entry) => {
        opened.push(entry.name);
        return true;
      }}
      onClose={() => closed.push(1)}
      {...props}
    />,
    transport,
  );
  mounted = root;
  const emit = async (event: NativeEvent): Promise<void> => {
    for (const listener of listeners) listener(event);
    await settle();
  };
  const node = (testID: string): string => {
    const id = root.nodeId(testID);
    if (!id) throw new Error(`no node ${testID}`);
    return id;
  };
  const type = (value: string) => emit({ type: "change", nodeId: node("launcher:field"), value });
  const key = (value: "Escape" | "ArrowUp" | "ArrowDown") => emit({ type: "key", nodeId: node("launcher:field"), value });
  const enter = () => emit({ type: "submit", nodeId: node("launcher:field"), value: "" });
  const hover = (rowId: string) => emit({ type: "hover", nodeId: node(`launcher:row:${rowId}`), hovered: true });
  /** Which of `candidates` are drawn as rows, top to bottom, and which one wears the selection. */
  const rows = (wanted: readonly string[] = candidates): { ids: string[]; selected: string | null } => {
    // The tree carries native ids; the rows are found by theirs.
    const byNative = new Map(wanted.flatMap((id) => (root.nodeId(`launcher:row:${id}`) ? [[root.nodeId(`launcher:row:${id}`) as string, id] as const] : [])));
    const ids: string[] = [];
    let selected: string | null = null;
    const walk = (at: unknown): void => {
      if (!at || typeof at !== "object") return;
      const each = at as Node;
      const native = (each.id ?? each.props?.id) as string | undefined;
      const row = native === undefined ? undefined : byNative.get(native);
      if (row !== undefined && !ids.includes(row)) {
        ids.push(row);
        // The wash is the row's own background, not a child's.
        if ((each.background ?? each.props?.background) === lightColors.selectionWash) selected = row;
      }
      for (const value of Object.values(each)) {
        if (Array.isArray(value)) value.forEach(walk);
        else if (value && typeof value === "object") walk(value);
      }
    };
    walk(JSON.parse(root.lastTree() ?? "null"));
    return { ids, selected };
  };
  const has = (testID: string): boolean => root.nodeId(testID) !== undefined;
  const tree = (): string => root.lastTree() ?? "";
  const unmount = () => {
    root.unmount();
    mounted = null;
  };
  await settle();
  return { opened, closed, type, key, enter, hover, rows, has, tree, unmount, emit, node };
}
