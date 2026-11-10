/**
 * The portal's Print (org.freedesktop.impl.portal.Print): a print sheet on
 * the asking window (sheet.tsx), and the job to CUPS over IPP (cups.ts),
 * with the app's pages as the PDF xdg-desktop-portal hands over as a
 * descriptor. Save as PDF is the sheet's button: the PDF is written where
 * the person says (the portal's own save sheet).
 *
 *   PreparePrint(o handle, s app_id, s parent_window, s title, a{sv} settings,
 *                a{sv} page_setup, a{sv} options) → (u, a{sv}{settings, page-setup, token u})
 *   Print(o handle, s app_id, s parent_window, s title, h fd, a{sv} options{token u})
 *     → (u, a{sv})
 */

import { fstatSync, readSync, writeFileSync } from "node:fs";
import { DBusError, ERRORS, type InterfaceSpec, Variant } from "../../../../src/shared/dbus/index.ts";
import { type Requests, Response, type ResponseCode } from "../request.ts";
import { cleanString, u32, vardict } from "../vardict.ts";
import type { Printer } from "./cups.ts";
import { choiceFrom, gtkSettings, type PrintChoice, PrintTokens, pdfPageCount } from "./settings.ts";

export const PRINT = "org.freedesktop.impl.portal.Print";

/** A document bigger than this is not read into memory to print. */
const MAX_PDF = 512 << 20;

export interface SheetRequest {
  appId: string;
  parent: string;
  title: string;
  printers: Printer[];
  start: PrintChoice;
  /** Pages in the document, when there is one yet (Print, not PreparePrint). */
  pages: number | null;
}

/** The sheet's answer: print with this choice, save a PDF, or nothing (Cancel). */
export type SheetAnswer = { kind: "print"; choice: PrintChoice } | { kind: "pdf"; choice: PrintChoice } | null;

export interface PrintDeps {
  printers(): Promise<Printer[]>;
  defaultPrinter(): Promise<string | null>;
  print(printer: Printer, title: string, pdf: Uint8Array, choice: PrintChoice): Promise<number>;
  ask(request: SheetRequest, signal: AbortSignal): Promise<SheetAnswer>;
  /** Where to save a PDF; null when the person cancelled. */
  savePath(request: Pick<SheetRequest, "appId" | "parent" | "title">, signal: AbortSignal): Promise<string | null>;
  writeFile?(path: string, data: Uint8Array): void;
}

/**
 * The document a descriptor holds, read whole. A file is read from its start
 * whatever its offset (the app may have just written it); a pipe, as it comes.
 */
export function readDocument(fd: number): Uint8Array {
  const stat = fstatSync(fd);
  const seekable = stat.isFile();
  if (stat.size > MAX_PDF) throw new DBusError(ERRORS.limitsExceeded, "the document is too big to print");
  let out = new Uint8Array(Math.max(stat.size, 64 * 1024));
  let at = 0;
  for (;;) {
    if (at === out.length) {
      if (out.length >= MAX_PDF) throw new DBusError(ERRORS.limitsExceeded, "the document is too big to print");
      const grown = new Uint8Array(Math.min(out.length * 2, MAX_PDF));
      grown.set(out);
      out = grown;
    }
    const got = readSync(fd, out, at, out.length - at, seekable ? at : null);
    if (got <= 0) break;
    at += got;
  }
  return out.subarray(0, at);
}

const text = (value: unknown, max = 512): string => (typeof value === "string" ? cleanString(value, max) : "");
const asDict = (value: unknown): Map<string, Variant> => new Map(vardict(value));

export class PrintBackend {
  private readonly tokens = new PrintTokens();

  constructor(
    private readonly requests: Requests,
    private readonly deps: PrintDeps,
  ) {}

  private async sheet(appId: string, parent: string, title: string, settings: Map<string, Variant>, pdf: Uint8Array | null, signal: AbortSignal) {
    const [printers, fallback] = await Promise.all([this.deps.printers().catch(() => []), this.deps.defaultPrinter().catch(() => null)]);
    const start = choiceFrom(settings, fallback ?? printers[0]?.name ?? null);
    if (start.printer && !printers.some((printer) => printer.name === start.printer)) start.printer = fallback ?? printers[0]?.name ?? null;
    const request: SheetRequest = { appId, parent, title, printers, start, pages: pdf ? pdfPageCount(pdf) : null };
    const answer = await this.deps.ask(request, signal);
    if (answer?.kind !== "pdf") return { answer, printers };
    const path = await this.deps.savePath(request, signal);
    return { answer: path ? { kind: "pdf" as const, choice: { ...answer.choice, printer: null, pdfPath: path } } : null, printers };
  }

  async prepare(args: readonly unknown[]): Promise<[ResponseCode, Map<string, unknown>]> {
    const [handle, appId, parent, title, settings, pageSetup] = args;
    return this.requests.run(handle, async (signal) => {
      const app = text(appId, 256);
      const { answer } = await this.sheet(app, text(parent, 256), text(title), asDict(settings), null, signal);
      if (!answer) return [Response.cancelled, new Map()];
      const token = this.tokens.keep(app, answer.choice);
      return [
        Response.success,
        new Map<string, unknown>([
          ["settings", new Variant("a{sv}", gtkSettings(answer.choice))],
          ["page-setup", new Variant("a{sv}", asDict(pageSetup))],
          ["token", new Variant("u", token)],
        ]),
      ];
    });
  }

  async print(args: readonly unknown[], fds: readonly number[] | undefined): Promise<[ResponseCode, Map<string, unknown>]> {
    const [handle, appId, parent, title, fdIndex, options] = args;
    const fd = typeof fdIndex === "number" ? fds?.[fdIndex] : undefined;
    if (fd === undefined) throw new DBusError(ERRORS.invalidArgs, "Print needs the document as a file descriptor");
    const pdf = readDocument(fd);
    const name = text(title) || "Document";
    return this.requests.run(handle, async (signal) => {
      const app = text(appId, 256);
      // A token another app was given is no token: this app is asked, on its own window.
      let choice = this.tokens.take(u32(vardict(options), "token"), app);
      let printers: Printer[] = [];
      if (!choice) {
        const asked = await this.sheet(app, text(parent, 256), name, new Map(), pdf, signal);
        if (!asked.answer) return [Response.cancelled, new Map()];
        choice = asked.answer.choice;
        printers = asked.printers;
      }
      try {
        if (choice.pdfPath) {
          (this.deps.writeFile ?? writeFileSync)(choice.pdfPath, pdf);
          return [Response.success, new Map()];
        }
        if (printers.length === 0) printers = await this.deps.printers();
        const printer = printers.find((each) => each.name === choice?.printer);
        if (!printer) throw new Error(`no printer called ${choice.printer ?? "(none)"}`);
        await this.deps.print(printer, name, pdf, choice);
        return [Response.success, new Map()];
      } catch (error) {
        console.error("dashi-portal: printing failed:", error instanceof Error ? error.message : error);
        return [Response.other, new Map()];
      }
    });
  }

  spec(): InterfaceSpec {
    return {
      name: PRINT,
      methods: {
        PreparePrint: { in: "osssa{sv}a{sv}a{sv}", out: "ua{sv}", handler: (args) => this.prepare(args) },
        Print: { in: "osssha{sv}", out: "ua{sv}", handler: (args, call) => this.print(args, call.fds) },
      },
      properties: { version: { type: "u", get: () => 3 } },
    };
  }
}
