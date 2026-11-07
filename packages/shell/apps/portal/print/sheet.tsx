/**
 * The print sheet: the printer, copies, pages and two-sided printing in
 * view, paper size and color under "More", Save as PDF as a button beside
 * Cancel and Print. Printers are CUPS's, as Settings would list them. Esc
 * cancels and Enter prints from anywhere in the sheet, a field included;
 * Copies keeps what is typed, and Print waits until it reads as a count.
 */

import { Button, Choices, PopUpButton, Row, TextField, useColors } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { useState } from "react";
import { variant } from "../../../src/dbus/index.ts";
import type { ChooseFiles } from "../file-chooser/index.tsx";
import { parseChooser } from "../file-chooser/options.ts";
import { CheckBox, PortalFrame } from "../ui/frame.tsx";
import type { ShowDialog } from "../windows.ts";
import { defaultPrinter, listPrinters, printPdf } from "./cups.ts";
import type { PrintDeps, SheetAnswer, SheetRequest } from "./index.ts";
import { everydayMedia, jobOptions, MAX_COPIES, mediaLabel, type PrintChoice, parseCopies, parseRanges } from "./settings.ts";

function PrintSheet({ request, answer }: { request: SheetRequest; answer: (value: SheetAnswer) => void }) {
  const colors = useColors();
  const [choice, setChoice] = useState<PrintChoice>(request.start);
  const [more, setMore] = useState(false);
  const [rangeMode, setRangeMode] = useState(request.start.pages !== "");
  // The field's own text: clearing it to type a new count must not snap back to 1.
  const [copiesText, setCopiesText] = useState(String(request.start.copies));
  const copies = parseCopies(copiesText);
  const printer = request.printers.find((each) => each.name === choice.printer) ?? null;
  const update = (patch: Partial<PrintChoice>) => setChoice({ ...choice, ...patch });
  const rangesOk = !rangeMode || (parseRanges(choice.pages, request.pages ?? 9999)?.length ?? 0) > 0;
  const canPrint = printer?.accepting === true && rangesOk && copies !== null;
  const twoSided = printer?.sides.some((side) => side.startsWith("two-sided")) === true;
  const media = printer ? everydayMedia(printer) : [];
  const final = (): PrintChoice => ({ ...choice, copies: copies ?? choice.copies, pages: rangeMode ? choice.pages : "" });
  const cancel = (): void => answer(null);
  const print = (): void => {
    if (canPrint) answer({ kind: "print", choice: final() });
  };
  const fieldKeys = (key: "Escape" | "ArrowUp" | "ArrowDown"): void => {
    if (key === "Escape") cancel();
  };
  return (
    <PortalFrame
      title={`Print “${request.title}”`}
      onCancel={cancel}
      footer={<Button label="Save as PDF…" testID="print:pdf" onPress={() => answer({ kind: "pdf", choice: final() })} />}
      buttons={[
        { label: "Cancel", testID: "print:cancel", onPress: cancel },
        { label: "Print", testID: "print:print", onPress: print, primary: true, disabled: !canPrint },
      ]}
    >
      {request.printers.length === 0 ? (
        <Text style={{ fontSize: 13, color: colors.textMuted }}>No printers are set up. Add one in Settings, or save a PDF.</Text>
      ) : (
        <Row label="Printer">
          {/* A list of unknown length is a pop-up button, not pills (UI-2). */}
          <PopUpButton
            testID="print:printer"
            width={220}
            options={request.printers.map((each) => ({ value: each.name, label: each.label }))}
            value={choice.printer ?? ""}
            onChange={(name) => update({ printer: name })}
          />
        </Row>
      )}
      {printer && !printer.accepting && <Text style={{ fontSize: 12, color: colors.critical }}>This printer isn’t taking jobs right now.</Text>}
      <Row label="Copies" {...(copies === null ? { detail: `A number from 1 to ${MAX_COPIES}` } : {})}>
        <TextField
          testID="print:copies"
          width={60}
          value={copiesText}
          onChangeText={(text) => setCopiesText(text.replace(/[^0-9]/g, "").slice(0, 4))}
          onSubmit={print}
          onKeyPress={fieldKeys}
        />
      </Row>
      <Row label={request.pages ? `Pages (${request.pages})` : "Pages"}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Choices
            testID="print:pages"
            options={[
              { value: "all", label: "All" },
              { value: "range", label: "Range" },
            ]}
            value={rangeMode ? "range" : "all"}
            onChange={(mode) => setRangeMode(mode === "range")}
          />
          {rangeMode && (
            <TextField
              testID="print:range"
              width={120}
              placeholder="1-3, 5"
              value={choice.pages}
              onChangeText={(pages) => update({ pages })}
              onSubmit={print}
              onKeyPress={fieldKeys}
            />
          )}
        </View>
      </Row>
      {twoSided && <CheckBox testID="print:two-sided" label="Two-sided" checked={choice.twoSided} onChange={(on) => update({ twoSided: on })} />}
      <View testID="print:more" onPress={() => setMore(!more)} style={{ flexDirection: "row" }}>
        <Text style={{ fontSize: 12, color: colors.selection }}>{more ? "Fewer Options" : "More…"}</Text>
      </View>
      {more && media.length > 0 && (
        <Row label="Paper">
          <PopUpButton
            testID="print:paper"
            width={220}
            options={media.map((keyword) => ({ value: keyword, label: mediaLabel(keyword) }))}
            value={choice.media ?? media[0] ?? ""}
            onChange={(keyword) => update({ media: keyword })}
          />
        </Row>
      )}
      {more && printer?.color && <CheckBox testID="print:color" label="Color" checked={choice.color} onChange={(on) => update({ color: on })} />}
    </PortalFrame>
  );
}

/** The print backend's machine side: CUPS, the sheet on screen, and the portal's save sheet for PDFs. */
export function printOnScreen(show: ShowDialog, chooseFiles: ChooseFiles): PrintDeps {
  return {
    printers: () => listPrinters(),
    defaultPrinter: () => defaultPrinter(),
    print: (printer, title, pdf, choice) => printPdf(printer, title, pdf, jobOptions(choice)),
    ask: (request, signal) =>
      show<SheetAnswer>(
        { parent: request.parent, title: "Print", width: 460, height: 360 },
        (answer) => <PrintSheet request={request} answer={answer} />,
        signal,
        null,
      ),
    async savePath(request, signal) {
      const name = `${request.title.replace(/[/\u0000-\u001f]+/g, " ").trim() || "Document"}.pdf`;
      const dict = new Map([
        ["current_name", variant("s", name)],
        ["filters", variant("a(sa(us))", [["PDF", [[1, "application/pdf"]]]])],
      ]);
      const answer = await chooseFiles(parseChooser("save", [request.appId, request.parent, "Save as PDF", dict]), signal);
      return answer?.paths[0] ?? null;
    },
  };
}
