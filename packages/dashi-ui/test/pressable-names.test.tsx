/**
 * Every pressable of @dashi/ui has a name a screen reader and an agent's
 * read_window can say (support/names.ts): its label, or the words in it. An
 * icon-only control that forgot `accessibilityLabel` fails here.
 */

import { expect, test } from "bun:test";
import { render, View } from "@mirinjs/metal";
import type { ReactNode } from "react";
import { AlertSheet } from "../src/alert.tsx";
import { Button } from "../src/button.tsx";
import { Choices } from "../src/choices.tsx";
import { CLOSE, MORE } from "../src/glyphs.ts";
import { MoreButton } from "../src/more.tsx";
import { Notice } from "../src/notice.tsx";
import { PopUpButton } from "../src/popup-button.tsx";
import { PopupMenu } from "../src/popup-menu.tsx";
import { SearchField } from "../src/search-field.tsx";
import { Segmented } from "../src/segmented.tsx";
import { SidebarItem } from "../src/sidebar.tsx";
import { ToolbarButton } from "../src/toolbar-button.tsx";
import { fakeHost } from "./host.ts";
import { noop } from "./support/controls-view.ts";
import { unnamedPressables } from "./support/names.ts";
import { fakeClockEachTest, settle } from "./support/time.ts";

fakeClockEachTest();

async function unnamed(ui: ReactNode): Promise<string[]> {
  const host = fakeHost();
  const root = render(<View>{ui}</View>, host.transport);
  await settle();
  const found = unnamedPressables(host.last());
  root.unmount();
  return found;
}

const OPTIONS = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
] as const;

test("the check finds a pressable with no name, and passes one with a label or words", async () => {
  expect(await unnamed(<View testID="x" onPress={noop} />)).toHaveLength(1);
  expect(await unnamed(<View testID="x" onPress={noop} accessibilityLabel="Close" />)).toEqual([]);
});

test("every @dashi/ui pressable has a name", async () => {
  const cases: Array<[string, ReactNode]> = [
    ["Button", <Button key="b" label="Save" testID="b" onPress={noop} />],
    ["Segmented", <Segmented key="s" options={OPTIONS} value="a" onChange={noop} testID="s" />],
    ["Choices", <Choices key="c" options={OPTIONS} value="a" onChange={noop} testID="c" />],
    ["SearchField with its clear button", <SearchField key="f" value="cats" onChangeText={noop} testID="f" />],
    ["Notice with its close button", <Notice key="n" text="Copied." onDismiss={noop} />],
    ["PopUpButton", <PopUpButton key="p" options={OPTIONS} value="a" onChange={noop} testID="p" />],
    ["MoreButton", <MoreButton key="m" open={false} onPress={noop} testID="m" />],
    ["SidebarItem", <SidebarItem key="i" label="Downloads" selected={false} onPress={noop} testID="i" />],
    ["ToolbarButton, glyph only", <ToolbarButton key="t" glyph={MORE} tooltip="More" onPress={noop} testID="t" />],
    ["PopupMenu and the room around it", <PopupMenu key="u" x={0} y={0} items={[{ label: "Open", onPress: noop }]} onClose={noop} />],
    ["AlertSheet", <AlertSheet key="a" question="Delete “Groceries”?" glyph={CLOSE} buttons={[{ label: "Delete", testID: "delete", onPress: noop }]} />],
  ];
  const missing: string[] = [];
  for (const [what, ui] of cases) if ((await unnamed(ui)).length > 0) missing.push(what);
  expect(missing).toEqual([]);
});
