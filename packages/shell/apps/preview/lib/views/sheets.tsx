/** Preview's sheets: file info, the Open With list, Export, and a plain message. */

import { AlertSheet, Button, Group, INFO, PopUpButton, Row, Sheet, Slider, useColors } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { useState } from "react";
import type { InfoRow } from "../../../../src/shared/file-browser/file-sheets.tsx";
import { formatDate, formatSize } from "../../../../src/shared/file-browser/format.ts";
import { tilde } from "../../../../src/shared/files/index.ts";
import { EXPORT_FORMATS, type ExportFormat } from "../convert.ts";
import { type FileFacts, formatCount, formatDimensions, megapixels } from "../info.ts";

/** The facts about the open file, as rows, written as Files writes them (one formatter, PA-14). */
export function infoRows(facts: FileFacts, extra: readonly InfoRow[], home = process.env.HOME ?? "/", locale?: string): InfoRow[] {
  return [
    ["Kind", facts.type],
    ...extra,
    ["Size", `${formatSize(facts.size)}${facts.size >= 1000 ? ` (${formatCount(facts.size, locale)} bytes)` : ""}`],
    ["Modified", formatDate(facts.modifiedMs, { locale })],
    ["Where", tilde(facts.folder, home)],
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

export interface ExportChoice {
  format: ExportFormat;
  /** 1 to 100, for JPEG. */
  quality: number;
}

/**
 * Export: which format, and for JPEG how good, then Export… asks where (the
 * desktop's save dialog). A PDF exports whole as a PDF, or the page in view
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
  const colors = useColors();
  const [format, setFormat] = useState<ExportFormat>(formats[0] ?? "png");
  const [quality, setQuality] = useState(0.9);
  const asPage = pageNote !== null && format !== "pdf";
  return (
    <Sheet testID="export" width={400} onCancel={onClose} onConfirm={() => onExport({ format, quality: Math.round(quality * 100) })}>
      <Text style={{ fontSize: 13, fontWeight: "bold", color: colors.text }}>Export</Text>
      <Group>
        <Row label="Format" detail={asPage ? pageNote : undefined}>
          <PopUpButton
            testID="export:format"
            width={120}
            options={formats.map((each) => ({ value: each, label: EXPORT_FORMATS[each].label }))}
            value={format}
            onChange={setFormat}
          />
        </Row>
        {format === "jpeg" && (
          <Row label="Quality" detail={`${Math.round(quality * 100)}%`}>
            <Slider testID="export:quality" width={160} value={quality} onChange={setQuality} range={{ min: 0.4, max: 1, step: 0.05 }} />
          </Row>
        )}
      </Group>
      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
        <Button label="Cancel" testID="export:cancel" onPress={onClose} />
        <Button label="Export…" testID="export:go" primary onPress={() => onExport({ format, quality: Math.round(quality * 100) })} />
      </View>
    </Sheet>
  );
}

export function MessageSheet({ title, message, onClose }: { title: string; message: string; onClose: () => void }) {
  // It only informs: one button, which Esc and Enter press too (UI-5).
  return (
    <AlertSheet
      testID="message"
      width={400}
      question={title}
      message={message}
      glyph={INFO}
      buttons={[{ label: "OK", testID: "message:ok", onPress: onClose, kind: "primary" }]}
    />
  );
}
