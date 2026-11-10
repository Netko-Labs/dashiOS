import { expect, test } from "bun:test";
import { writeSync } from "node:fs";
import { jobAttributes, listPrinters, printerOf, printPdf } from "../apps/portal/print/cups.ts";
import { PrintBackend, type PrintDeps } from "../apps/portal/print/index.ts";
import { attr, decodeResponse, encodeRequest, Operation, Tag, ValueTag } from "../apps/portal/print/ipp.ts";
import { choiceFrom, everydayMedia, gtkSettings, mediaLabel, PrintTokens, parseRanges, pdfPageCount } from "../apps/portal/print/settings.ts";
import type { Exporter } from "../apps/portal/request.ts";
import { Requests } from "../apps/portal/request.ts";
import { type Variant, variant } from "../src/shared/dbus/index.ts";
import { closeFd, pipePair } from "../src/shared/dbus/libc.ts";

/** An IPP response as CUPS would send it: printers, with a collection in the middle to read past. */
function printersResponse(): Uint8Array {
  const request = encodeRequest(0x0000, 7, [
    { tag: Tag.operation, attributes: [attr("attributes-charset", ValueTag.charset, "utf-8")] },
    {
      tag: Tag.printer,
      attributes: [
        attr("printer-name", ValueTag.name, "Brother_HL"),
        attr("printer-info", ValueTag.text, "Brother HL-L2350"),
        attr("printer-state", ValueTag.enum, 3),
        attr("printer-is-accepting-jobs", ValueTag.boolean, true),
        attr("color-supported", ValueTag.boolean, false),
        attr("sides-supported", ValueTag.keyword, "one-sided", "two-sided-long-edge"),
        attr("media-supported", ValueTag.keyword, "iso_a4_210x297mm", "na_letter_8.5x11in"),
        attr("media-default", ValueTag.keyword, "iso_a4_210x297mm"),
      ],
    },
    { tag: Tag.printer, attributes: [attr("printer-name", ValueTag.name, "PDF"), attr("color-supported", ValueTag.boolean, true)] },
  ]);
  // Splice a collection (media-col-default {media-size {x-dimension 21000}}) into the first printer group.
  const collection: number[] = [];
  const put = (tag: number, name: string, value: Uint8Array) => {
    const n = new TextEncoder().encode(name);
    collection.push(tag, n.length >> 8, n.length & 0xff, ...n, value.length >> 8, value.length & 0xff, ...value);
  };
  const text = (s: string) => new TextEncoder().encode(s);
  put(ValueTag.begCollection, "media-col-default", new Uint8Array());
  put(ValueTag.memberAttrName, "", text("media-size"));
  put(ValueTag.begCollection, "", new Uint8Array());
  put(ValueTag.memberAttrName, "", text("x-dimension"));
  put(ValueTag.integer, "", new Uint8Array([0, 0, 0x52, 0x08]));
  put(ValueTag.endCollection, "", new Uint8Array());
  put(ValueTag.endCollection, "", new Uint8Array());
  const marker = new TextEncoder().encode("printer-name");
  const at = request.findIndex((_, i) => marker.every((byte, j) => request[i + j] === byte)) - 3;
  return new Uint8Array([...request.subarray(0, at), ...collection, ...request.subarray(at)]);
}

test("IPP: a request encodes as CUPS reads it, and a response decodes with its collections read past", () => {
  const body = encodeRequest(Operation.cupsGetPrinters, 1, [
    { tag: Tag.operation, attributes: [attr("requested-attributes", ValueTag.keyword, "printer-name", "printer-info")] },
  ]);
  expect([...body.subarray(0, 8)]).toEqual([2, 0, 0x40, 0x02, 0, 0, 0, 1]);
  expect(body.at(-1)).toBe(Tag.end);
  const response = decodeResponse(printersResponse());
  expect(response.status).toBe(0);
  const printers = response.groups.filter((group) => group.tag === Tag.printer).flatMap((group) => printerOf(group) ?? []);
  expect(printers.map((printer) => [printer.name, printer.label, printer.state, printer.sides])).toEqual([
    ["Brother_HL", "Brother HL-L2350", "idle", ["one-sided", "two-sided-long-edge"]],
    ["PDF", "PDF", "idle", []],
  ]);
  expect(() => decodeResponse(new Uint8Array([2, 0, 0, 0, 0, 0, 0, 1, 1, 0x44, 0, 9]))).toThrow();
});

test("printers come from CUPS-Get-Printers; a job is a Print-Job with the PDF after the attributes", async () => {
  const posted: Array<[string, Uint8Array]> = [];
  const post = async (path: string, body: Uint8Array) => {
    posted.push([path, body]);
    if (posted.length === 1) return printersResponse();
    return encodeRequest(0x0000, 2, [
      { tag: Tag.operation, attributes: [] },
      { tag: Tag.job, attributes: [attr("job-id", ValueTag.integer, 31)] },
    ]);
  };
  const printers = await listPrinters(post);
  const printer = printers[0];
  if (!printer) throw new Error("no printer");
  const pdf = new TextEncoder().encode("%PDF-1.7 pages");
  const id = await printPdf(printer, "Lease", pdf, { copies: 2, ranges: [[1, 3]], sides: "two-sided-long-edge", color: true, media: null }, post);
  expect(id).toBe(31);
  const [path, body] = posted[1] ?? ["", new Uint8Array()];
  expect(path).toBe("/printers/Brother_HL");
  expect([...body.subarray(2, 4)]).toEqual([0, Operation.printJob]);
  expect(new TextDecoder().decode(body.subarray(body.length - pdf.length))).toBe("%PDF-1.7 pages");
  // A printer without color isn't told about color; two-sided only where it can.
  const job = jobAttributes({ copies: 1, ranges: [], sides: "two-sided-short-edge", color: true, media: "iso_a4_210x297mm" }, printer);
  expect(job.attributes.map((a) => a.name)).toEqual(["copies", "media"]);
});

test("print settings: ranges, GTK's settings both ways (0-based ranges), paper names", () => {
  expect(parseRanges("1-3, 5, 8-", 10)).toEqual([
    [1, 3],
    [5, 5],
    [8, 10],
  ]);
  expect(parseRanges("")).toEqual([]);
  expect(parseRanges("3-1")).toBeNull();
  expect(parseRanges("0")).toBeNull();
  expect(parseRanges("a")).toBeNull();
  const settings = new Map<string, Variant>([
    ["printer", variant("s", "Brother_HL")],
    ["n-copies", variant("s", "3")],
    ["print-pages", variant("s", "ranges")],
    ["page-ranges", variant("s", "0-2,4")],
    ["duplex", variant("s", "horizontal")],
    ["use-color", variant("s", "false")],
  ]);
  const choice = choiceFrom(settings, "Other");
  expect(choice).toMatchObject({ printer: "Brother_HL", copies: 3, pages: "1-3, 5", twoSided: true, color: false });
  const back = gtkSettings(choice);
  expect(back.get("page-ranges")?.value).toBe("0-2,4");
  expect(back.get("print-pages")?.value).toBe("ranges");
  expect(back.get("duplex")?.value).toBe("vertical");
  expect(choiceFrom(new Map(), "Default")).toMatchObject({ printer: "Default", copies: 1, pages: "", twoSided: false, color: true });
  expect(mediaLabel("iso_a4_210x297mm")).toBe("A4");
  expect(mediaLabel("na_letter_8.5x11in")).toBe("Letter");
  expect(everydayMedia({ media: ["na_letter_8.5x11in", "iso_a4_210x297mm", "custom_x"], mediaDefault: "na_letter_8.5x11in" })).toEqual([
    "na_letter_8.5x11in",
    "iso_a4_210x297mm",
  ]);
  expect(pdfPageCount(new TextEncoder().encode("<< /Type /Pages /Kids [] /Count 12 >> /Type /Page"))).toBe(12);
  expect(pdfPageCount(new TextEncoder().encode("not a pdf"))).toBeNull();
});

test("tokens: PreparePrint's choice is used once, and not after it expires", () => {
  let now = 0;
  const tokens = new PrintTokens(1000, () => now);
  const choice = choiceFrom(new Map(), "P");
  const token = tokens.keep("org.gnome.TextEditor", choice);
  expect(tokens.take(token, "org.gnome.TextEditor")).toEqual(choice);
  expect(tokens.take(token, "org.gnome.TextEditor")).toBeNull();
  const late = tokens.keep("org.gnome.TextEditor", choice);
  now = 5000;
  expect(tokens.take(late, "org.gnome.TextEditor")).toBeNull();
  expect(tokens.take(undefined, "org.gnome.TextEditor")).toBeNull();
});

test("tokens: random, and only the app that was given one can use it", () => {
  const values = [0, 7, 7, 9];
  const tokens = new PrintTokens(
    1000,
    () => 0,
    () => values.shift() ?? 1,
  );
  const choice = choiceFrom(new Map(), "P");
  expect(tokens.keep("org.gnome.TextEditor", choice)).toBe(7);
  expect(tokens.keep("org.gnome.Papers", choice)).toBe(9);
  expect(tokens.take(7, "org.gnome.Papers")).toBeNull();
  expect(tokens.take(7, "org.gnome.TextEditor")).toEqual(choice);
  expect(new PrintTokens().keep("a", choice)).not.toBe(new PrintTokens().keep("a", choice));
});

const fakeBus: Exporter = { export: (path) => ({ path, emit: () => {}, propertiesChanged: () => {}, unexport: () => {} }) };

test("Print with PreparePrint's token prints the descriptor's PDF without asking again", async () => {
  const printed: Array<[string, string, number]> = [];
  let asked = 0;
  const printer = { name: "P", label: "P", location: "", state: "idle" as const, accepting: true, color: true, sides: [], media: [], mediaDefault: null };
  const deps: PrintDeps = {
    printers: async () => [printer],
    defaultPrinter: async () => "P",
    print: async (p, title, pdf, choice) => {
      printed.push([p.name, `${title}:${new TextDecoder().decode(pdf)}`, choice.copies]);
      return 1;
    },
    ask: async (request) => {
      asked++;
      return { kind: "print", choice: { ...request.start, copies: 2 } };
    },
    savePath: async () => null,
  };
  const backend = new PrintBackend(new Requests(fakeBus), deps);
  const [code, results] = await backend.prepare(["/r/1", "org.gnome.TextEditor", "", "Notes", new Map(), new Map(), new Map()]);
  expect(code).toBe(0);
  const token = (results.get("token") as Variant).value as number;
  const pipe = pipePair();
  writeSync(pipe.write, "%PDF-1.7");
  closeFd(pipe.write);
  const [printedCode] = await backend.print(["/r/2", "org.gnome.TextEditor", "", "Notes", 0, new Map([["token", variant("u", token)]])], [pipe.read]);
  closeFd(pipe.read);
  expect(printedCode).toBe(0);
  expect(asked).toBe(1);
  expect(printed).toEqual([["P", "Notes:%PDF-1.7", 2]]);
});

test("Print rejects a token PreparePrint gave a different app: it asks, and nothing goes to the first app's PDF", async () => {
  const written: string[] = [];
  const asked: string[] = [];
  const deps: PrintDeps = {
    printers: async () => [],
    defaultPrinter: async () => null,
    print: async () => 0,
    ask: async (request) => {
      asked.push(request.appId);
      return request.appId === "org.gnome.TextEditor" ? { kind: "pdf", choice: request.start } : null;
    },
    savePath: async () => "/home/alexk/Notes.pdf",
    writeFile: (path) => void written.push(path),
  };
  const backend = new PrintBackend(new Requests(fakeBus), deps);
  const [, results] = await backend.prepare(["/r/6", "org.gnome.TextEditor", "", "Notes", new Map(), new Map(), new Map()]);
  const token = (results.get("token") as Variant).value as number;
  const pipe = pipePair();
  writeSync(pipe.write, "%PDF-1.7");
  closeFd(pipe.write);
  const [code] = await backend.print(["/r/7", "com.example.Other", "", "Other", 0, new Map([["token", variant("u", token)]])], [pipe.read]);
  closeFd(pipe.read);
  expect(code).toBe(1);
  expect(asked).toEqual(["org.gnome.TextEditor", "com.example.Other"]);
  expect(written).toEqual([]);
});

test("Print without a token asks; Cancel prints nothing; a PDF save writes the document", async () => {
  const written: Array<[string, string]> = [];
  let answer: "cancel" | "pdf" = "cancel";
  const deps: PrintDeps = {
    printers: async () => [],
    defaultPrinter: async () => null,
    print: async () => 0,
    ask: async (request) => (answer === "cancel" ? null : { kind: "pdf", choice: request.start }),
    savePath: async () => "/home/alex/Notes.pdf",
    writeFile: (path, data) => void written.push([path, new TextDecoder().decode(data)]),
  };
  const backend = new PrintBackend(new Requests(fakeBus), deps);
  const document = () => {
    const pipe = pipePair();
    writeSync(pipe.write, "%PDF-1.4");
    closeFd(pipe.write);
    return pipe.read;
  };
  const first = document();
  expect((await backend.print(["/r/3", "", "", "Notes", 0, new Map()], [first]))[0]).toBe(1);
  closeFd(first);
  answer = "pdf";
  const second = document();
  expect((await backend.print(["/r/4", "", "", "Notes", 0, new Map()], [second]))[0]).toBe(0);
  closeFd(second);
  expect(written).toEqual([["/home/alex/Notes.pdf", "%PDF-1.4"]]);
  await expect(backend.print(["/r/5", "", "", "Notes", 0, new Map()], [])).rejects.toThrow("file descriptor");
});
