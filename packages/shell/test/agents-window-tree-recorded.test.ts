/**
 * read_window's lines for trees recorded on a real toolkit
 * (bin/dashi-a11y-dump.ts; dashi-0.9.0-review/29-windowtree/dumps/): GTK 4
 * under a headless weston on a private accessibility bus; mirin Metal (main
 * 50241ea) and Qt 6 in the VM.
 */

import { expect, test } from "bun:test";
import { TreeNumbers } from "../src/agents/window-tree/lib/numbers.ts";
import { renderTree } from "../src/agents/window-tree/lib/render.ts";
import type { Element } from "../src/agents/window-tree/types.ts";
import trash from "./fixtures/window-tree/gtk4-empty-trash.json";
import sample from "./fixtures/window-tree/gtk4-sample.json";
import gaps from "./fixtures/window-tree/metal-gaps.json";
import qt from "./fixtures/window-tree/qt6-fcitx.json";

function lines(root: unknown): string {
  const numbers = new TreeNumbers();
  // A recorded tree is the reader's own output, written as JSON by the dump.
  return renderTree(root as Element, { window: 4, numberOf: (e, p, said) => numbers.number(4, e.key, p?.key ?? null, said) }).text;
}

test("a GTK 4 window: controls with their states, a secret not read, a list in pages, rows named by their words", () => {
  const text = lines(sample.root);
  expect(text).toContain('switch "Wi-Fi" (off)');
  expect(text).toContain('checkbox "Reduce motion" (not checked)');
  expect(text).toContain('textbox "Name" value="hello"');
  expect(text).toContain("password field (filled: yes)");
  expect(text).not.toContain("secret");
  expect(text).toContain('slider "Volume" value=50 (0–100)');
  expect(text).toMatch(/\[\d+\] list \(240 rows; rows 1–40 here; next: read_window \{"window":"w4","list":\d+,"from":40\}\)/);
  expect(text).toContain('list item "Row 40"');
  expect(text).not.toContain('"Row 41"');
  // GTK's own window buttons are in its tree (client-side decorations).
  expect(text).toContain('button "Close"');
});

test("a GTK 4 sheet: its button that loses work for good is critical; GTK's destructive style is not on the bus", () => {
  const text = lines(trash.root);
  expect(text).toContain("Items in the Trash are deleted for good.");
  expect(text).toMatch(/\[\d+\] button "Cancel"\n/);
  expect(text).toContain('button "Empty Trash" (critical: loses work)');
});

test("a Metal window: a password field that can't say whether it is filled, all 240 rows of a virtualized list, a dialog", () => {
  const text = lines(gaps.root);
  expect(text).toContain("## Gaps");
  expect(text).toContain(`password field "Password" (filled: can't tell)`);
  expect(text).not.toContain("secret");
  expect(text).toContain('checkbox "Wi-Fi" (not checked)');
  expect(text).toMatch(/\[\d+\] list "Rows"/);
  expect(text).toContain('list item "Row 240"');
  expect(text).toContain('dialog "Delete “Groceries”?" (modal)');
  // A pressable with no words is a button with no name (for-mirin.md §8).
  expect(text).toMatch(/\[\d+\] button\n/);
});

test("a Qt 6 window, read through Get where Qt answers no GetAll: names, disabled buttons, a tree in pages", () => {
  const text = lines(qt.root);
  expect(text).toContain('combobox "Default" (collapsed, focused)');
  expect(text).toContain('button "Remove" (disabled)');
  expect(text).toContain('list item "Pinyin"');
  expect(text).toMatch(/tree \(105 rows; rows 1–40 here/);
});
