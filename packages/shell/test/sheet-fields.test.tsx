/**
 * Every app sheet with a field opens with the caret in that field. In the
 * 0.5.0 review build a sheet's Esc and Enter came through a hidden field that
 * asked for the keyboard too, so two fields asked at once and the host gave
 * it to either (Files' Rename sometimes opened with no caret, and what was
 * typed went nowhere). Now exactly one field in each sheet asks, inside the
 * sheet's trap, and the sheet's keys are a window-key view, not a field;
 * mirin's host picks the first field asking in the trap if ever there are two.
 */

import { afterAll, expect, test } from "bun:test";
import { type NativeTransport, render } from "@mirinjs/metal";
import type { ReactElement } from "react";
import { blankDraft } from "../apps/calendar/lib/draft.ts";
import { EventSheet } from "../apps/calendar/lib/sheets/event-sheet.tsx";
import { ImportPathSheet } from "../apps/calendar/lib/sheets/file-sheets.tsx";
import { CalendarSheet } from "../apps/calendar/lib/sheets/sheets.tsx";
import { ReplaceSheet } from "../apps/editor/lib/views/sheets.tsx";
import { ChooserSheet, openChooser } from "../apps/files/chooser/index.ts";
import { NotesSheet } from "../apps/notes/lib/views/sheets.tsx";
import { chooserRequest } from "../src/shared/files/chooser/request.ts";
import { settle } from "./support/time.ts";

interface Node {
  type: string;
  props?: { id?: string; autofocus?: boolean; focusTrap?: boolean; onWindowKey?: boolean };
  children?: Node[];
}

async function tree(element: ReactElement): Promise<{ root: Node; nodeId: (testID: string) => string | undefined }> {
  const trees: string[] = [];
  const transport: NativeTransport = { send: (sent) => void trees.push(sent), onEvent() {}, onClose() {}, simulate() {}, close() {} };
  const mounted = render(element, transport);
  await settle();
  const found = { root: JSON.parse(trees.at(-1) ?? "{}") as Node, nodeId: (testID: string) => mounted.nodeId(testID) };
  mounted.unmount();
  return found;
}

/** The inputs, each with whether it is inside a focus trap. */
function inputs(node: Node, trapped = false): Array<{ id: string; autofocus: boolean; trapped: boolean }> {
  const inTrap = trapped || node.props?.focusTrap === true;
  const own = node.type === "input" ? [{ id: node.props?.id ?? "", autofocus: node.props?.autofocus === true, trapped: inTrap }] : [];
  return [...own, ...(node.children ?? []).flatMap((child) => inputs(child, inTrap))];
}

const noop = (): void => {};
// Text Editor's Save As is Files' chooser over the window: its name field asks for the keyboard.
const saving = openChooser(chooserRequest("save", { currentName: "a.txt" }), undefined, { watch: false });
afterAll(() => saving.stop());
const SHEETS: Array<[string, ReactElement, string]> = [
  ["Text Editor › Save As (Files' chooser)", <ChooserSheet key="save" model={saving} title="Save As" exists={() => false} answer={noop} />, "chooser:name"],
  [
    "Notes › New Folder",
    <NotesSheet
      key="notes"
      sheet={{ kind: "new-folder" }}
      onClose={noop}
      actions={{ createFolder: noop, renameFolder: noop, deleteFolder: noop, purge: noop, emptyTrash: noop }}
    />,
    "name-field",
  ],
  [
    "Calendar › New Calendar",
    <CalendarSheet key="cal" title="New Calendar" initialName="" initialColor="#2F6F5A" confirmLabel="Create" onSubmit={noop} onCancel={noop} />,
    "calendar-name",
  ],
  ["Calendar › Import", <ImportPathSheet key="import" reason="Pick a file." onSubmit={noop} onCancel={noop} />, "import-path"],
  [
    "Calendar's event",
    <EventSheet
      key="event"
      draft={blankDraft("home", "2026-11-06", 540)}
      calendars={[{ id: "home", name: "Home", color: "#2F6F5A" } as never]}
      prefs={{ locale: "en-US", hour24: undefined, showDate: false } as never}
      editing={null}
      onSave={noop}
      onDelete={noop}
      onCancel={noop}
    />,
    "event-title",
  ],
  ["Text Editor › Find and Replace", <ReplaceSheet key="replace" query="" matches={0} onQuery={noop} onReplaceAll={() => 0} onCancel={noop} />, "replace:find"],
];

for (const [name, element, field] of SHEETS) {
  test(`${name}: its field, and only it, asks for the keyboard, inside the sheet`, async () => {
    const { root, nodeId } = await tree(element);
    const asking = inputs(root).filter((input) => input.autofocus);
    expect(asking).toEqual([{ id: nodeId(field) as string, autofocus: true, trapped: true }]);
  });
}
