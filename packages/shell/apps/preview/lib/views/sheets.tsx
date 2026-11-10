/** Preview's sheets: file info, the Open With list, Export, and a plain message. */

import { AlertSheet, Button, Group, INFO, PopUpButton, Row, Sheet, Slider, useColors } from "@dashi/ui";
import { Image, Text, View } from "@mirinjs/metal";
import { useState } from "react";
import { EXPORT_FORMATS, type ExportFormat } from "../convert.ts";
import type { Handler } from "../handlers.ts";
import { type FileFacts, formatBytes, formatCount, formatDate, formatDimensions, megapixels } from "../info.ts";

export type InfoRow = readonly [label: string, value: string];

/** The facts about the open file, as rows. */
export function infoRows(facts: FileFacts, extra: readonly InfoRow[], locale?: string): InfoRow[] {
  return [
    ["Kind", facts.type],
    ...extra,
    ["Size", `${formatBytes(facts.size, locale)}${facts.size >= 1000 ? ` (${formatCount(facts.size, locale)} bytes)` : ""}`],
    ["Modified", formatDate(facts.modifiedMs, locale)],
    ["Where", facts.folder],
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

/** Info: the file's name as the heading, its facts as a card of rows. */
export function InfoSheet({ name, rows, onClose }: { name: string; rows: readonly InfoRow[]; onClose: () => void }) {
  const colors = useColors();
  return (
    <Sheet testID="info-sheet" width={460} onCancel={onClose} onConfirm={onClose}>
      <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: "bold", color: colors.text }}>
        {name}
      </Text>
      <Group testID="info-sheet:rows">
        {rows.map(([label, value]) => (
          <Row key={label} label={label} wraps>
            {/* Two thirds of the row, from a zero basis: a long value wraps there, the row grows with it, and the label stays on its first line. */}
            <View testID={`info-sheet:${label}`} style={{ flex: 2, minWidth: 0 }}>
              <Text style={{ fontSize: 13, color: colors.textMuted, textAlign: "right" }}>{value}</Text>
            </View>
          </Row>
        ))}
      </Group>
      <View style={{ flexDirection: "row", justifyContent: "flex-end", marginTop: 4 }}>
        <Button label="Done" testID="info-sheet:done" primary onPress={onClose} />
      </View>
    </Sheet>
  );
}

export function OpenWithSheet({
  handlers,
  loading,
  onPick,
  onClose,
}: {
  handlers: readonly Handler[];
  loading: boolean;
  onPick: (handler: Handler) => void;
  onClose: () => void;
}) {
  const colors = useColors();
  return (
    <Sheet testID="open-with" width={380} onCancel={onClose}>
      <Text style={{ fontSize: 13, fontWeight: "bold", color: colors.text }}>Open With</Text>
      {loading ? (
        <Text style={{ fontSize: 12, color: colors.textMuted }}>Looking for apps…</Text>
      ) : handlers.length === 0 ? (
        <Text style={{ fontSize: 12, color: colors.textMuted }}>No other app opens this kind of file.</Text>
      ) : (
        // A card on the heading's edge, as Info's and Export's rows are. One Tab stop; ↑ and ↓ move between the
        // apps, Return opens with the one that has the keyboard (KB-1).
        <Group testID="open-with:card">
          <View focusGroup style={{ flexDirection: "column", gap: 2, padding: 4, maxHeight: 280, overflow: "scroll" }} testID="open-with:list">
            {handlers.map((handler) => (
              <View
                key={handler.id}
                testID={`open-with:${handler.id}`}
                focusable
                accessibilityRole="button"
                accessibilityLabel={handler.name}
                onPress={() => onPick(handler)}
                style={{
                  height: 30,
                  flexShrink: 0,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  paddingHorizontal: 8,
                  borderRadius: 6,
                  // A wash under the pointer, never kombu (CO-2).
                  hoverBackgroundColor: colors.button,
                }}
              >
                <Image source={handler.icon} resizeMode="contain" style={{ width: 20, height: 20 }} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ fontSize: 13, color: colors.text }}>
                    {handler.name}
                  </Text>
                </View>
                {handler.isDefault && <Text style={{ fontSize: 11, color: colors.textMuted }}>Default</Text>}
              </View>
            ))}
          </View>
        </Group>
      )}
      <View style={{ flexDirection: "row", justifyContent: "flex-end", marginTop: 6 }}>
        <Button label="Cancel" testID="open-with:cancel" onPress={onClose} />
      </View>
    </Sheet>
  );
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
