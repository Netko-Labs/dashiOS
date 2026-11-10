/**
 * CUPS over IPP (ipp.ts): the printers it has, its default, and a job. It is
 * reached through its local socket (/run/cups/cups.sock), where it knows the
 * caller by its credentials, else http://localhost:631. Printers are listed
 * as CUPS lists them, so they are the ones Settings (and `lpstat`) shows.
 */

import { userInfo } from "node:os";
import { attr, decodeResponse, encodeRequest, type IppGroup, type IppResponse, Operation, succeeded, Tag, ValueTag, valueOf, valuesOf } from "./ipp.ts";

export const CUPS_SOCKET = "/run/cups/cups.sock";

export interface Printer {
  name: string;
  /** What Settings calls it (printer-info), else its name. */
  label: string;
  location: string;
  state: "idle" | "printing" | "stopped";
  accepting: boolean;
  color: boolean;
  /** Two-sided printing it can do. */
  sides: string[];
  /** Paper sizes it takes (IPP media keywords) and the one it starts with. */
  media: string[];
  mediaDefault: string | null;
}

export interface JobOptions {
  copies: number;
  /** Page ranges, 1-based and inclusive; empty for all. */
  ranges: Array<[number, number]>;
  sides: "one-sided" | "two-sided-long-edge" | "two-sided-short-edge";
  color: boolean;
  media: string | null;
}

/** POSTs an IPP request to CUPS and reads the answer. */
export type IppPost = (path: string, body: Uint8Array) => Promise<Uint8Array>;

export const cupsPost: IppPost = async (path, body) => {
  const init = { method: "POST", headers: { "Content-Type": "application/ipp" }, body };
  let response: Response;
  try {
    response = await fetch(`http://localhost${path}`, { ...init, unix: CUPS_SOCKET });
  } catch {
    response = await fetch(`http://localhost:631${path}`, init);
  }
  if (!response.ok) throw new Error(`CUPS answered ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
};

let nextId = 1;

const operationGroup = (...extra: ReturnType<typeof attr>[]): IppGroup => ({
  tag: Tag.operation,
  attributes: [attr("attributes-charset", ValueTag.charset, "utf-8"), attr("attributes-natural-language", ValueTag.naturalLanguage, "en"), ...extra],
});

async function ask(post: IppPost, path: string, operation: number, groups: IppGroup[], document?: Uint8Array): Promise<IppResponse> {
  const response = decodeResponse(await post(path, encodeRequest(operation, nextId++, groups, document)));
  if (!succeeded(response)) {
    const message = response.groups.find((g) => g.tag === Tag.operation);
    const text = message ? valueOf(message, "status-message") : undefined;
    throw new Error(typeof text === "string" && text ? text : `CUPS refused (status 0x${response.status.toString(16)})`);
  }
  return response;
}

const STATES: Record<number, Printer["state"]> = { 3: "idle", 4: "printing", 5: "stopped" };

export function printerOf(group: IppGroup): Printer | null {
  const name = valueOf(group, "printer-name");
  if (typeof name !== "string" || !/^[^/#\s][^/#]{0,126}$/.test(name)) return null;
  const info = valueOf(group, "printer-info");
  const location = valueOf(group, "printer-location");
  const strings = (key: string) => valuesOf(group, key).filter((value): value is string => typeof value === "string");
  const mediaDefault = valueOf(group, "media-default");
  return {
    name,
    label: typeof info === "string" && info ? info : name,
    location: typeof location === "string" ? location : "",
    state: STATES[Number(valueOf(group, "printer-state"))] ?? "idle",
    accepting: valueOf(group, "printer-is-accepting-jobs") !== false,
    color: valueOf(group, "color-supported") === true,
    sides: strings("sides-supported"),
    media: strings("media-supported"),
    mediaDefault: typeof mediaDefault === "string" ? mediaDefault : null,
  };
}

const PRINTER_ATTRIBUTES = [
  "printer-name",
  "printer-info",
  "printer-location",
  "printer-state",
  "printer-is-accepting-jobs",
  "color-supported",
  "sides-supported",
  "media-supported",
  "media-default",
];

export async function listPrinters(post: IppPost = cupsPost): Promise<Printer[]> {
  const response = await ask(post, "/", Operation.cupsGetPrinters, [operationGroup(attr("requested-attributes", ValueTag.keyword, ...PRINTER_ATTRIBUTES))]);
  return response.groups.filter((group) => group.tag === Tag.printer).flatMap((group) => printerOf(group) ?? []);
}

export async function defaultPrinter(post: IppPost = cupsPost): Promise<string | null> {
  try {
    const response = await ask(post, "/", Operation.cupsGetDefault, [operationGroup(attr("requested-attributes", ValueTag.keyword, "printer-name"))]);
    const group = response.groups.find((g) => g.tag === Tag.printer);
    const name = group ? valueOf(group, "printer-name") : undefined;
    return typeof name === "string" ? name : null;
  } catch {
    return null;
  }
}

/** The job's attributes, as the printer is asked them. */
export function jobAttributes(options: JobOptions, printer: Pick<Printer, "color" | "sides">): IppGroup {
  const attributes = [attr("copies", ValueTag.integer, Math.max(1, Math.min(999, Math.round(options.copies))))];
  if (options.ranges.length > 0) attributes.push(attr("page-ranges", ValueTag.rangeOfInteger, ...options.ranges));
  if (options.sides !== "one-sided" ? printer.sides.includes(options.sides) : printer.sides.length > 0)
    attributes.push(attr("sides", ValueTag.keyword, options.sides));
  if (printer.color) attributes.push(attr("print-color-mode", ValueTag.keyword, options.color ? "color" : "monochrome"));
  if (options.media) attributes.push(attr("media", ValueTag.keyword, options.media));
  return { tag: Tag.job, attributes };
}

/** Sends a PDF to a printer; resolves with the job's id. */
export async function printPdf(printer: Printer, title: string, pdf: Uint8Array, options: JobOptions, post: IppPost = cupsPost): Promise<number> {
  const path = `/printers/${encodeURIComponent(printer.name)}`;
  const response = await ask(
    post,
    path,
    Operation.printJob,
    [
      operationGroup(
        attr("printer-uri", ValueTag.uri, `ipp://localhost${path}`),
        attr("requesting-user-name", ValueTag.name, userInfo().username),
        attr("job-name", ValueTag.name, title.slice(0, 255) || "Document"),
        attr("document-format", ValueTag.mimeMediaType, "application/pdf"),
      ),
      jobAttributes(options, printer),
    ],
    pdf,
  );
  const job = response.groups.find((group) => group.tag === Tag.job);
  const id = job ? valueOf(job, "job-id") : undefined;
  return typeof id === "number" ? id : 0;
}
