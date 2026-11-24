/** Preview's sheet of its own, Export (a form sheet, UI-15), and the rows its Info shows (the sheet is shared: file-sheets.tsx). */

import { FormSheet, Group, PopUpButton, Row, Slider } from "@dashi/ui";
import { useState } from "react";
import type { InfoRow } from "../../../../src/shared/file-browser/file-sheets.tsx";
import { formatDate, formatPlace, formatSize } from "../../../../src/shared/file-browser/format.ts";
import { EXPORT_FORMATS, type ExportFormat } from "../convert.ts";
import { type FileFacts, formatCount, formatDimensions, megapixels } from "../info.ts";

/** The facts about the open file, as rows, written as Files writes them (one formatter, PA-14). */
export function infoRows(facts: FileFacts, extra: readonly InfoRow[], home = process.env.HOME ?? "/", locale?: string): InfoRow[] {
  return [
    ["Kind", facts.type],
    ...extra,
    ["Size", `${formatSize(facts.size)}${facts.size >= 1000 ? ` (${formatCount(facts.size, locale)} bytes)` : ""}`],
    ["Modified", formatDate(facts.modifiedMs, { locale })],
    ["Where", formatPlace(facts.folder, home)],
  ];
}

const TURNED: Readonly<Record<number, string>> = { 1: "90° clockwise", 2: "180°", 3: "90° counterclockwise" };

/** The rows an image adds: its size in pixels and megapixels, how it is rotated, and how it is shown. */
export function imageRows(width: number, height: number, turns: number, note: string | null, locale?: string): InfoRow[] {
  const mp = megapixels(width, height, locale);
  const quarter = ((turns % 4) + 4) % 4;
  return [
    ["Dimensions", `${formatDimensions(width, height, locale)} pixels${mp ? ` (${mp})` : ""}`],
    ...(quarter !== 0 ? ([["Rotated", TURNED[quarter] as string]] as InfoRow[]) : []),
    ...(note ? ([["Shown", note]] as InfoRow[]) : []),
  ];
}

/** The rows a PDF adds. */
export function pdfRows(pages: number, title: string | null, page: { width: number; height: number } | null, turns: number, locale?: string): InfoRow[] {
  const quarter = ((turns % 4) + 4) % 4;
  return [
    ["Pages", formatCount(pages, locale)],
    ...(title ? ([["Title", title]] as InfoRow[]) : []),
    ...(page ? ([["Page size", `${formatDimensions(Math.round(page.width), Math.round(page.height), locale)} pt`]] as InfoRow[]) : []),
    ...(quarter !== 0 ? ([["Rotated", TURNED[quarter] as string]] as InfoRow[]) : []),
  ];
}

/** Export's widths: the sheet, the format's pop-up, the quality's slider. */
const EXPORT_SHEET = { width: 400, format: 120, quality: 160 } as const;

export interface ExportChoice {
  format: ExportFormat;
  /** 1 to 100, for JPEG. */
  quality: number;
}

/**
 * Export: which format, and for JPEG how good, then Export… asks where (Files'
 * chooser, in this sheet's place). A PDF exports whole as a PDF, or the page in view
 * as a picture.
 */
export function ExportSheet({
  formats,
  pageNote,
  onExport,
  onClose,
}: {
  formats: readonly ExportFormat[];
  /** Said under the format when a picture of one page is what a PDF exports ("Page 3"). */
  pageNote: string | null;
  onExport: (choice: ExportChoice) => void;
  onClose: () => void;
}) {
  const [format, setFormat] = useState<ExportFormat>(formats[0] ?? "png");
  const [quality, setQuality] = useState(0.9);
  const asPage = pageNote !== null && format !== "pdf";
  const go = (): void => onExport({ format, quality: Math.round(quality * 100) });
  return (
    <FormSheet
      testID="export"
      title="Export"
      width={EXPORT_SHEET.width}
      buttons={[
        { label: "Cancel", testID: "export:cancel", cancel: true, onPress: onClose },
        { label: "Export…", testID: "export:go", kind: "primary", onPress: go },
      ]}
    >
      <Group>
        <Row label="Format" detail={asPage ? pageNote : undefined}>
          <PopUpButton
            testID="export:format"
            width={EXPORT_SHEET.format}
            options={formats.map((each) => ({ value: each, label: EXPORT_FORMATS[each].label }))}
            value={format}
            onChange={setFormat}
          />
        </Row>
        {format === "jpeg" && (
          <Row label="Quality" detail={`${Math.round(quality * 100)}%`}>
            <Slider testID="export:quality" width={EXPORT_SHEET.quality} value={quality} onChange={setQuality} range={{ min: 0.4, max: 1, step: 0.05 }} />
          </Row>
        )}
      </Group>
    </FormSheet>
  );
}
