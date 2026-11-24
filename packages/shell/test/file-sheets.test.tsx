// Get Info and Open With, one sheet each for Files, Preview and the chooser (design.html PA-18, UI-13, UI-15).
import { expect, test } from "bun:test";
import { type NativeEvent, type NativeTransport, render } from "@mirinjs/metal";
import type { ReactElement } from "react";
import { itemRows } from "../apps/files/lib/views/sheets.tsx";
import { infoRows } from "../apps/preview/lib/views/sheets.tsx";
import { firstChoice, InfoSheet, type OpenWithChoice, OpenWithSheet } from "../src/shared/file-browser/file-sheets.tsx";
import { settle } from "./support/time.ts";

function mount(element: ReactElement) {
  const listeners: ((event: NativeEvent) => void)[] = [];
  const trees: string[] = [];
  const transport: NativeTransport = {
    send: (tree) => trees.push(tree),
    onEvent: (listener) => listeners.push(listener),
    onClose() {},
    simulate() {},
    close() {},
  };
  const root = render(element, transport);
  const press = (testID: string): void => {
    const nodeId = root.nodeId(testID);
    if (!nodeId) throw new Error(`no node ${testID}`);
    for (const listener of listeners) listener({ type: "press", nodeId });
  };
  return { root, press, last: () => trees.at(-1) ?? "" };
}

const APPS: OpenWithChoice[] = [
  { id: "org.gnome.Loupe.desktop", name: "Image Viewer", icon: "/none.svg" },
  { id: "dev.dashi.preview.desktop", name: "Preview", icon: "/none.svg", isDefault: true },
];

test("Open With: the default is chosen first and tagged; a press on another row chooses it, a second opens", async () => {
  expect(firstChoice(APPS)).toBe("dev.dashi.preview.desktop");
  expect(firstChoice([])).toBeNull();
  const picked: string[] = [];
  const { root, press, last } = mount(<OpenWithSheet name="Report.pdf" apps={APPS} onPick={(app) => picked.push(app.id)} onClose={() => {}} />);
  await settle();
  expect(last()).toContain("Open “Report.pdf” with");
  expect(last()).toContain("Default");
  press("open-with:org.gnome.Loupe.desktop");
  await settle();
  expect(picked).toEqual([]);
  press("open-with:org.gnome.Loupe.desktop");
  press("open-with:open");
  await settle();
  expect(picked).toEqual(["org.gnome.Loupe.desktop", "org.gnome.Loupe.desktop"]);
  root.unmount();
});

test("Open With with no app says so plainly", async () => {
  const { root, last } = mount(<OpenWithSheet name="a.xyz" apps={[]} onPick={() => {}} onClose={() => {}} />);
  await settle();
  expect(last()).toContain("No other app opens this kind of file.");
  root.unmount();
});

test("Info: the name is the heading, Done closes; Files and Preview write a file the same way", async () => {
  let closed = false;
  const { root, press, last } = mount(<InfoSheet name="Report.pdf" rows={[["Kind", "PDF document"]]} onClose={() => (closed = true)} />);
  await settle();
  expect(last()).toContain("Report.pdf");
  expect(last()).not.toContain("Report.pdf Info");
  press("info-sheet:done");
  expect(closed).toBe(true);
  root.unmount();
  const modified = new Date(2026, 0, 2, 11, 32).getTime();
  const files = itemRows(
    {
      name: "Report.pdf",
      path: "/home/alexk/Documents/Report.pdf",
      kind: "PDF document",
      mime: "application/pdf",
      size: 58_312,
      where: "~/Documents",
      modified,
      accessed: modified,
      created: null,
      permissions: "rw-r--r--",
      octal: "644",
      owner: "alexk",
      group: "alexk",
      target: null,
      isFolder: false,
    },
    null,
  );
  const preview = infoRows(
    {
      name: "Report.pdf",
      folder: "/home/alexk/Documents",
      path: "/home/alexk/Documents/Report.pdf",
      size: 58_312,
      modifiedMs: modified,
      type: "PDF document",
      mime: "application/pdf",
    },
    [],
    "/home/alexk",
    "en-US",
  );
  const value = (rows: readonly (readonly [string, string])[], label: string): string | undefined => rows.find(([each]) => each === label)?.[1];
  for (const label of ["Size", "Modified", "Where"]) expect(value(preview, label)).toBe(value(files, label));
});
