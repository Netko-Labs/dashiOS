// The document a Print is handed: read off its descriptor without holding the portal, and cut to the pages asked for
// when it is saved as a PDF (apps/portal/lib/print/backend.ts, cut.ts).
import { expect, test } from "bun:test";
import { writeSync } from "node:fs";
import { DOCUMENT_WAIT_MS, PrintBackend, type PrintDeps, readDocument } from "../apps/portal/lib/print/backend.ts";
import { cutPages, qpdfRange } from "../apps/portal/lib/print/cut.ts";
import type { Exporter } from "../apps/portal/lib/request.ts";
import { Requests } from "../apps/portal/lib/request.ts";
import { closeFd, pipePair } from "../src/shared/dbus/libc.ts";
import { fakeClock } from "./support/time.ts";

const fakeBus: Exporter = { export: (path) => ({ path, emit: () => {}, propertiesChanged: () => {}, unexport: () => {} }) };

test("a PDF saved with a page range holds those pages, not the whole document", async () => {
  const written: string[] = [];
  const cuts: Array<Array<[number, number]>> = [];
  const deps: PrintDeps = {
    printers: async () => [],
    defaultPrinter: async () => null,
    print: async () => 0,
    ask: async (request) => ({ kind: "pdf", choice: { ...request.start, pages: "2-3, 5" } }),
    savePath: async () => "/home/alexk/Notes.pdf",
    writeFile: (_path, data) => void written.push(new TextDecoder().decode(data)),
    cutPages: async (_pdf, ranges) => {
      cuts.push(ranges);
      return new TextEncoder().encode("%PDF cut");
    },
  };
  const backend = new PrintBackend(new Requests(fakeBus), deps);
  const pipe = pipePair();
  writeSync(pipe.write, "%PDF whole");
  closeFd(pipe.write);
  expect((await backend.print(["/r/8", "", "", "Notes", 0, new Map()], [pipe.read]))[0]).toBe(0);
  closeFd(pipe.read);
  expect(cuts).toEqual([
    [
      [2, 3],
      [5, 5],
    ],
  ]);
  expect(written).toEqual(["%PDF cut"]);
  // A cut that can't be made (no qpdf) writes nothing: never every page under a name that says some.
  const failing = new PrintBackend(new Requests(fakeBus), { ...deps, cutPages: () => Promise.reject(new Error("no qpdf")) });
  const again = pipePair();
  writeSync(again.write, "%PDF whole");
  closeFd(again.write);
  expect((await failing.print(["/r/9", "", "", "Notes", 0, new Map()], [again.read]))[0]).toBe(2);
  closeFd(again.read);
  expect(written).toEqual(["%PDF cut"]);
});

test("pages are cut by qpdf, kept within the document", async () => {
  expect(
    qpdfRange(
      [
        [1, 3],
        [5, 5],
        [8, 9999],
      ],
      10,
    ),
  ).toBe("1-3,5,8-10");
  expect(qpdfRange([[2, 9999]], 2)).toBe("2");
  expect(qpdfRange([[11, 12]], 10)).toBeNull();
  const ran: string[][] = [];
  const run = async (args: readonly string[]): Promise<string> => {
    ran.push(args.map((arg) => arg.replace(/^.*\//, "")));
    if (args[0] === "--show-npages") return "4\n";
    await Bun.write(args.at(-1) as string, "%PDF cut");
    return "";
  };
  expect(new TextDecoder().decode(await cutPages(new TextEncoder().encode("%PDF whole"), [[2, 9]], run))).toBe("%PDF cut");
  expect(ran).toEqual([
    ["--show-npages", "whole.pdf"],
    ["--empty", "--pages", "whole.pdf", "2-4", "--", "cut.pdf"],
  ]);
  await expect(cutPages(new Uint8Array(), [[7, 8]], run)).rejects.toThrow("none of those pages");
});

test("a document on a pipe is read without waiting on it, and one that never ends is given up on", async () => {
  const clock = fakeClock();
  try {
    const pipe = pipePair();
    writeSync(pipe.write, "%PDF-1.7");
    // The app keeps its end open: the read must not hold the portal while it does.
    const read = readDocument(pipe.read).then(
      (pdf) => new TextDecoder().decode(pdf),
      (error: Error) => error.message,
    );
    await clock.advance(DOCUMENT_WAIT_MS + 1);
    expect(await read).toContain("the document never finished arriving");
    closeFd(pipe.write);
    closeFd(pipe.read);
  } finally {
    clock.restore();
  }
});
