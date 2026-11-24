/**
 * Which of Preview's sheets is up over the window, what answering it does,
 * and the window's overlay: a sheet, or the "…" menu hung from its button.
 */

import { ConfirmSheet, type MenuEntry, PopupMenu } from "@dashi/ui";
import type { ReactElement } from "react";
import { InfoSheet, OpenWithSheet } from "../../../../src/shared/file-browser/file-sheets.tsx";
import type { ChooserRequest } from "../../../../src/shared/files/index.ts";
import * as commands from "../commands.ts";
import type { ExportFormat } from "../convert.ts";
import * as glyphs from "../glyphs.ts";
import type { Handler } from "../handlers.ts";
import type { Snapshot } from "../snapshot.ts";
import { turned } from "../zoom.ts";
import { FileChooser } from "./chooser.tsx";
import { type ExportChoice, ExportSheet, imageRows, infoRows, pdfRows } from "./sheets.tsx";

/** The sheet up over the window: a question, a form, or Files' chooser (Open, and where an Export goes: R7). */
export type SheetState =
  | { kind: "info" }
  | { kind: "open-with"; handlers: Handler[] | null }
  | { kind: "open"; request: ChooserRequest }
  | { kind: "export"; formats: ExportFormat[] }
  | { kind: "save"; request: ChooserRequest; choice: ExportChoice }
  | { kind: "print-cups"; printer: string; pdf: string }
  | null;

/** The window's state the overlay shows (use-chrome.ts holds it; that file imports SheetState from here, so the type is named here). */
export interface OverlayChrome {
  sheet: SheetState;
  menu: { x: number; y: number } | null;
  setSheet(sheet: SheetState): void;
  setMenu(menu: null): void;
}

/** What the window holds over its content: the sheet that is up, else the "…" menu, hung from its button; nothing otherwise. */
export function windowOverlay({
  chrome,
  snap,
  page,
  hooks,
  moreItems,
}: {
  chrome: OverlayChrome;
  snap: Snapshot;
  /** The PDF's page in view. */
  page: number;
  hooks: commands.CommandHooks;
  moreItems: MenuEntry[];
}): ReactElement | undefined {
  if (chrome.sheet !== null) {
    return <PreviewSheet sheet={chrome.sheet} snap={snap} page={page} hooks={hooks} onSheet={chrome.setSheet} onClose={() => chrome.setSheet(null)} />;
  }
  if (chrome.menu) {
    return <PopupMenu testID="more-menu" x={chrome.menu.x} y={chrome.menu.y} anchor="end" items={moreItems} onClose={() => chrome.setMenu(null)} />;
  }
  return undefined;
}

/** Get Info: the file's facts, then the page's or the picture's own. */
function infoSheet(snap: Snapshot, page: number, onClose: () => void): ReactElement | null {
  const { pdf } = snap;
  if (!snap.facts) return null;
  const upright = snap.natural ? turned(snap.natural, snap.turns) : null;
  const extra = pdf
    ? pdfRows(pdf.pages, pdf.title, pdf.sizes[page - 1] ?? null, snap.turns)
    : upright
      ? imageRows(upright.width, upright.height, snap.turns, snap.note)
      : [];
  return <InfoSheet name={snap.facts.name} rows={infoRows(snap.facts, extra)} onClose={onClose} />;
}

export function PreviewSheet({
  sheet,
  snap,
  page,
  hooks,
  onSheet,
  onClose,
}: {
  sheet: Exclude<SheetState, null>;
  snap: Snapshot;
  /** The PDF's page in view. */
  page: number;
  hooks: commands.CommandHooks;
  /** Another sheet in this one's place (the export's chooser after its format). */
  onSheet: (next: SheetState) => void;
  onClose: () => void;
}) {
  switch (sheet.kind) {
    case "info":
      return infoSheet(snap, page, onClose);
    case "open-with":
      return (
        <OpenWithSheet
          name={snap.name}
          apps={sheet.handlers}
          onClose={onClose}
          onPick={(handler) => {
            onClose();
            if (snap.path) commands.launchWith(hooks, handler, snap.path);
          }}
        />
      );
    case "open":
      return (
        <FileChooser
          request={sheet.request}
          answer={(paths) => {
            onClose();
            if (paths?.[0]) void hooks.viewer.open(paths[0]);
          }}
        />
      );
    case "export":
      return (
        <ExportSheet
          formats={sheet.formats}
          pageNote={snap.kind === "pdf" ? `Page ${page}, as a picture` : null}
          onClose={onClose}
          onExport={(choice) => onSheet({ kind: "save", request: commands.exportRequest(snap, choice, page), choice })}
        />
      );
    case "save":
      return (
        <FileChooser
          request={sheet.request}
          answer={(paths) => {
            onClose();
            if (paths?.[0]) void commands.exportTo(hooks, snap, sheet.choice, page, paths[0]);
          }}
        />
      );
    case "print-cups":
      return (
        <ConfirmSheet
          testID="print"
          title={`Print “${snap.name}” on ${sheet.printer}?`}
          message="It prints on your default printer, one copy of every page."
          confirmLabel="Print"
          glyph={glyphs.DOCUMENT}
          onCancel={onClose}
          onConfirm={() => {
            onClose();
            commands.printOn(hooks, sheet.printer, sheet.pdf, snap.name);
          }}
        />
      );
  }
}
