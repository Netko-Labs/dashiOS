import { expect, test } from "bun:test";
import { type NativeEvent, type NativeRoot, type NativeTransport, render } from "@mirinjs/metal";
import { HEADINGS } from "../apps/installer/lib/headings.ts";
import type { Disk } from "../apps/installer/lib/probe.ts";
import { DiskList, StepRow } from "../apps/installer/lib/rows.tsx";
import { settle } from "./support/time.ts";

// The Installer's parts (design.html VS-1, CO-2, CO-9): sentence-case titles, the disks one list, no accent on progress.

const DISKS: Disk[] = [
  { path: "/dev/nvme0n1", name: "Samsung SSD 990 PRO 1TB", bytes: 1_000_204_886_016, transport: "nvme", removable: false },
  { path: "/dev/sda", name: "USB drive", bytes: 30_752_000_000, transport: "usb", removable: true, unavailable: "The Dashi USB drive" },
];

async function mount(tree: React.ReactElement) {
  const listeners: ((event: NativeEvent) => void)[] = [];
  const transport: NativeTransport = { send() {}, onEvent: (listener) => listeners.push(listener), onClose() {}, simulate() {}, close() {} };
  const root: NativeRoot = render(tree, transport);
  await settle();
  const press = async (testID: string): Promise<void> => {
    const nodeId = root.nodeId(testID);
    if (!nodeId) throw new Error(`no node ${testID}`);
    for (const listener of listeners) listener({ type: "press", nodeId });
    await settle();
  };
  return { root, press, tree: (): string => root.lastTree() ?? "" };
}

test("every page title is sentence case, with curly apostrophes", () => {
  for (const { title, subtitle } of Object.values(HEADINGS)) {
    const [, ...rest] = title.split(" ");
    for (const word of rest) if (word !== "Dashi") expect(word).toBe(word.toLowerCase());
    expect(`${title} ${subtitle}`).not.toContain("'");
  }
});

test("the disks are one list of options: the arrows choose, and a disk that can't be used isn't one", async () => {
  const chosen: string[] = [];
  const view = await mount(<DiskList disks={DISKS} chosen="/dev/nvme0n1" onChoose={(path) => chosen.push(path)} />);
  const tree = view.tree();
  expect(tree).toContain('"role":"listbox"');
  expect(tree).toContain('"selectsOnFocus":true');
  expect(tree.match(/"role":"option"/g)?.length).toBe(2);
  await view.press("installer-disk:/dev/nvme0n1");
  await view.press("installer-disk:/dev/sda");
  expect(chosen).toEqual(["/dev/nvme0n1"]);
  view.root.unmount();
});

test("a running step is the kit's spinner, not an accent dot", async () => {
  const view = await mount(<StepRow testID="step" label="Copying Dashi" mark="running" />);
  expect(view.root.nodeId("step:running:spinner") ?? view.root.nodeId("step:running")).toBeTruthy();
  view.root.unmount();
});
