/**
 * What the print sheet decides, and how it travels: from the GTK print
 * settings an app passes (PreparePrint's `settings`, string values as
 * GtkPrintSettings keeps them), back to them for the app, and on to CUPS as
 * a job's attributes (cups.ts). PreparePrint's answer carries a token; the
 * Print that follows with it prints with the same choices, without asking.
 */

import { Variant } from "../../../src/dbus/index.ts";
import type { JobOptions, Printer } from "./cups.ts";

export interface PrintChoice {
  /** A CUPS printer's name; null saves a PDF instead (`pdfPath`). */
  printer: string | null;
  pdfPath: string | null;
  copies: number;
  /** "" for all pages; else ranges as typed ("1-3, 5"). */
  pages: string;
  twoSided: boolean;
  color: boolean;
  media: string | null;
}

/** `1-3, 5, 8-` as 1-based inclusive ranges; null when it doesn't read (a range backwards, a 0, junk). `last` closes an open end. */
export function parseRanges(text: string, last = 9999): Array<[number, number]> | null {
  const trimmed = text.trim();
  if (trimmed === "") return [];
  const ranges: Array<[number, number]> = [];
  for (const part of trimmed.split(/\s*,\s*/)) {
    const match = /^(\d{1,5})(?:\s*-\s*(\d{0,5}))?$/.exec(part);
    if (!match) return null;
    const start = Number(match[1]);
    const end = match[2] === undefined ? start : match[2] === "" ? last : Number(match[2]);
    if (start < 1 || end < start) return null;
    ranges.push([start, end]);
  }
  return ranges.slice(0, 64);
}

const value = (settings: ReadonlyMap<string, Variant>, key: string): string | undefined => {
  const entry = settings.get(key);
  return entry?.signature === "s" && typeof entry.value === "string" ? entry.value : undefined;
};

/** The sheet's starting point from an app's GTK print settings, over the printer's defaults. */
export function choiceFrom(settings: ReadonlyMap<string, Variant>, fallbackPrinter: string | null): PrintChoice {
  const copies = Number.parseInt(value(settings, "n-copies") ?? "1", 10);
  // GTK keeps page ranges 0-based ("0-2,4"); the sheet shows them as people count.
  const ranges =
    value(settings, "print-pages") === "ranges"
      ? (value(settings, "page-ranges") ?? "")
          .split(",")
          .map((part) =>
            part
              .trim()
              .split("-")
              .map((n) => Number.parseInt(n, 10) + 1)
              .filter(Number.isFinite)
              .join("-"),
          )
          .filter(Boolean)
          .join(", ")
      : "";
  return {
    printer: value(settings, "printer") ?? fallbackPrinter,
    pdfPath: null,
    copies: Number.isFinite(copies) && copies > 0 ? Math.min(copies, 999) : 1,
    pages: ranges,
    twoSided: (value(settings, "duplex") ?? "simplex") !== "simplex",
    color: value(settings, "use-color") !== "false",
    media: null,
  };
}

/** The choice as GTK print settings, for PreparePrint's answer. */
export function gtkSettings(choice: PrintChoice): Map<string, Variant> {
  const out = new Map<string, Variant>();
  const set = (key: string, text: string) => out.set(key, new Variant("s", text));
  set("printer", choice.printer ?? "Print to File");
  set("n-copies", String(choice.copies));
  const ranges = parseRanges(choice.pages) ?? [];
  set("print-pages", ranges.length > 0 ? "ranges" : "all");
  if (ranges.length > 0) set("page-ranges", ranges.map(([a, b]) => (a === b ? `${a - 1}` : `${a - 1}-${b - 1}`)).join(","));
  set("duplex", choice.twoSided ? "vertical" : "simplex");
  set("use-color", choice.color ? "true" : "false");
  if (choice.pdfPath) {
    set("output-file-format", "pdf");
    set("output-uri", `file://${choice.pdfPath}`);
  }
  return out;
}

export function jobOptions(choice: PrintChoice): JobOptions {
  return {
    copies: choice.copies,
    ranges: parseRanges(choice.pages) ?? [],
    sides: choice.twoSided ? "two-sided-long-edge" : "one-sided",
    color: choice.color,
    media: choice.media,
  };
}

/** A paper size's name from its IPP keyword: `iso_a4_210x297mm` → "A4", `na_letter_8.5x11in` → "Letter". */
export function mediaLabel(keyword: string): string {
  const match = /^[a-z]+_([a-z0-9.-]+?)_[\d.]+x[\d.]+(mm|in)$/i.exec(keyword);
  const name = match ? (match[1] as string) : keyword;
  if (/^[a-c]\d+$/i.test(name)) return name.toUpperCase();
  return name.charAt(0).toUpperCase() + name.slice(1).replace(/-/g, " ");
}

/** The paper sizes worth offering: the printer's default, then the everyday ones it has. */
export function everydayMedia(printer: Pick<Printer, "media" | "mediaDefault">): string[] {
  const common = ["iso_a4_210x297mm", "na_letter_8.5x11in", "na_legal_8.5x14in", "iso_a5_148x210mm", "iso_a3_297x420mm"];
  const listed = common.filter((keyword) => printer.media.includes(keyword));
  return [...new Set([...(printer.mediaDefault ? [printer.mediaDefault] : []), ...listed])];
}

/** How many pages a PDF has, by counting its page objects; a guess for the sheet's "1 of N", never used to cut pages. */
export function pdfPageCount(pdf: Uint8Array): number | null {
  const text = new TextDecoder("latin1").decode(pdf.subarray(0, Math.min(pdf.length, 64 << 20)));
  const counts = [...text.matchAll(/\/Type\s*\/Pages\b[^>]*?\/Count\s+(\d+)/g)].map((match) => Number(match[1]));
  if (counts.length > 0) return Math.max(...counts);
  const pages = text.match(/\/Type\s*\/Page\b(?!s)/g)?.length ?? 0;
  return pages > 0 ? pages : null;
}

/** PreparePrint's choices, kept for the Print that comes with the token. */
export class PrintTokens {
  private readonly kept = new Map<number, { choice: PrintChoice; until: number }>();
  private next = 1;

  constructor(
    private readonly ttlMs = 10 * 60 * 1000,
    private readonly now: () => number = Date.now,
  ) {}

  keep(choice: PrintChoice): number {
    for (const [token, entry] of this.kept) if (entry.until < this.now()) this.kept.delete(token);
    const token = this.next++;
    this.kept.set(token, { choice, until: this.now() + this.ttlMs });
    return token;
  }

  /** The choice for a token, once. */
  take(token: number | undefined): PrintChoice | null {
    if (token === undefined) return null;
    const entry = this.kept.get(token);
    this.kept.delete(token);
    return entry && entry.until >= this.now() ? entry.choice : null;
  }
}
