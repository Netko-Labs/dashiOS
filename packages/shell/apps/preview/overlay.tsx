/** Which of Preview's sheets is up over the window, and what answering it does. */

import { ConfirmSheet } from "@dashi/ui";
import * as commands from "./commands.ts";
import type { ExportFormat } from "./convert.ts";
import * as glyphs from "./glyphs.ts";
import type { Handler } from "./handlers.ts";
import { ExportSheet, InfoSheet, imageRows, infoRows, MessageSheet, OpenWithSheet, pdfRows } from "./sheets.tsx";
import type { Snapshot } from "./snapshot.ts";
import { turned } from "./zoom.ts";

export type SheetState =
  | { kind: "info" }
  | { kind: "open-with"; handlers: Handler[] | null }
  | { kind: "trash" }
  | { kind: "export"; formats: ExportFormat[] }
  | { kind: "print-cups"; printer: string; pdf: string }
  | { kind: "message"; title: string; message: string }
  | null;

export function PreviewSheet({
  sheet,
  snap,
  page,
  hooks,
  onClose,
}: {
  sheet: Exclude<SheetState, null>;
  snap: Snapshot;
  /** The PDF's page in view. */
  page: number;
  hooks: commands.CommandHooks;
  onClose: () => void;
}) {
  const { pdf } = snap;
  switch (sheet.kind) {
    case "info": {
      if (!snap.facts) return null;
      const upright = snap.natural ? turned(snap.natural, snap.turns) : null;
      const extra = pdf
        ? pdfRows(pdf.pages, pdf.title, pdf.sizes[page - 1] ?? null, snap.turns)
        : upright
          ? imageRows(upright.width, upright.height, snap.turns, snap.note)
          : [];
      return <InfoSheet name={snap.facts.name} rows={infoRows(snap.facts, extra)} onClose={onClose} />;
    }
    case "open-with":
      return (
        <OpenWithSheet
          handlers={sheet.handlers ?? []}
          loading={sheet.handlers === null}
          onClose={onClose}
          onPick={(handler) => {
            onClose();
            if (snap.path) commands.launchWith(hooks, handler, snap.path);
          }}
        />
      );
    case "trash":
      return (
        <ConfirmSheet
          testID="trash"
          title={`Move “${snap.name}” to the Trash?`}
          message="You can put it back from the Trash."
          confirmLabel="Move to Trash"
          glyph={glyphs.TRASH}
          danger
          onCancel={onClose}
          onConfirm={() => {
            onClose();
            commands.trash(hooks, snap);
          }}
        />
      );
    case "export":
      return (
        <ExportSheet
          formats={sheet.formats}
          pageNote={snap.kind === "pdf" ? `Page ${page}, as a picture` : null}
          onClose={onClose}
          onExport={(choice) => {
            onClose();
            void commands.exportTo(hooks, snap, choice, page);
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
    case "message":
      return <MessageSheet title={sheet.title} message={sheet.message} onClose={onClose} />;
  }
}
