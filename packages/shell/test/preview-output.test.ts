import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportImageArgs, thumbnailArgs, turnPngArgs } from "../apps/preview/lib/convert.ts";
import { exportFile, exportFormats, exportName, printablePdf, qpdfRotateArgs, type Source } from "../apps/preview/lib/output.ts";
import { answerIn, outcomeOf, parseDefaultPrinter, responseRule } from "../apps/preview/lib/print.ts";
import type { RunOptions, RunResult } from "../apps/preview/lib/tools.ts";
import { MessageType } from "../src/shared/dbus/index.ts";

// What leaves Preview: Export, the PDF Print hands over (output.ts), and the print dialog's answer (print.ts).

const dir = mkdtempSync(join(tmpdir(), "dashi-preview-output-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const stamp = { path: "/home/alexk/a.jpg", mtimeMs: 1, size: 2 };
const all = { magick: true, qpdf: true };

describe("export", () => {
  test("a PDF exports whole or a page as a picture; a picture as any; nothing without the helper", () => {
    expect(exportFormats("pdf", "pdf", all)).toEqual(["pdf", "png", "jpeg"]);
    expect(exportFormats("pdf", "pdf", { magick: false, qpdf: false })).toEqual(["pdf", "png"]);
    expect(exportFormats("image", "jpeg", all)).toEqual(["png", "jpeg", "pdf"]);
    expect(exportFormats("image", "svg", all)).toEqual([]);
    expect(exportFormats("image", "png", { magick: false, qpdf: true })).toEqual([]);
  });

  test("the name a save dialog starts with", () => {
    expect(exportName("Lease.pdf", "png", 3)).toBe("Lease page 3.png");
    expect(exportName("photo.heic", "jpeg", null)).toBe("photo.jpg");
    expect(exportName(".hidden", "pdf", null)).toBe(".hidden.pdf");
  });

  test("a picture is written upright and rotated as shown; JPEG on white at the quality asked", () => {
    expect(exportImageArgs("jpeg", 1, "jpeg", 80, "/out.jpg")?.slice(-13)).toEqual([
      "jpeg:-[0]",
      "-auto-orient",
      "-rotate",
      "90",
      "-background",
      "white",
      "-alpha",
      "remove",
      "-alpha",
      "off",
      "-quality",
      "80",
      "jpeg:/out.jpg",
    ]);
    expect(exportImageArgs("png", 0, "pdf", 92, "/out.pdf")?.at(-1)).toBe("pdf:/out.pdf");
    expect(exportImageArgs("svg", 0, "png", 92, "/out.png")).toBeNull();
    expect(thumbnailArgs("png", "/t.png")?.slice(-3)).toEqual(["-thumbnail", "300x300>", "png:/t.png"]);
    // A turned picture's thumbnail is turned as it is shown.
    expect(thumbnailArgs("png", "/t.png", 1)?.slice(-6)).toEqual(["-auto-orient", "-rotate", "90", "-thumbnail", "300x300>", "png:/t.png"]);
    expect(turnPngArgs("/c/p.png", 3, "/c/t.png").slice(-6)).toEqual(["png:/c/p.png", "-rotate", "270", "-define", "png:compression-level=1", "png:/c/t.png"]);
    expect(qpdfRotateArgs("/a.pdf", 2, "/b.pdf")).toEqual(["qpdf", "/a.pdf", "--rotate=+180:1-z", "/b.pdf"]);
  });

  test("a rotated PDF goes through qpdf; without it the pages are written as they are, and the person is told", async () => {
    const pdf = join(dir, "lease.pdf");
    writeFileSync(pdf, "%PDF-1.4 fake");
    const source: Source = { path: pdf, kind: "pdf", format: "pdf", stamp: { path: pdf, mtimeMs: 1, size: 13 }, turns: 1 };
    const ran: string[][] = [];
    const run = async (argv: readonly string[], _options: RunOptions): Promise<RunResult> => {
      ran.push([...argv]);
      writeFileSync(argv.at(-1) as string, "%PDF rotated");
      return { ok: true, code: 0, stdout: "", stderr: "", timedOut: false };
    };
    const target = join(dir, "out.pdf");
    expect(await exportFile(source, { to: "pdf", quality: 90, page: 1, target }, dir, all, run)).toEqual({ ok: true, unrotated: false });
    expect(ran[0]?.[0]).toBe("qpdf");
    expect(readFileSync(target, "utf8")).toBe("%PDF rotated");
    const plain = join(dir, "plain.pdf");
    expect(await exportFile(source, { to: "pdf", quality: 90, page: 1, target: plain }, dir, { magick: true, qpdf: false }, run)).toEqual({
      ok: true,
      unrotated: true,
    });
    expect(readFileSync(plain, "utf8")).toBe("%PDF-1.4 fake");
  });

  test("a failed export leaves nothing behind", async () => {
    const source: Source = { path: join(dir, "a.jpg"), kind: "image", format: "jpeg", stamp, turns: 0 };
    writeFileSync(source.path, "jpeg");
    const run = async (): Promise<RunResult> => ({ ok: false, code: 1, stdout: "", stderr: "", timedOut: false });
    const target = join(dir, "never.png");
    expect(await exportFile(source, { to: "png", quality: 90, page: 1, target }, dir, all, run)).toEqual({ ok: false });
    expect(existsSync(target)).toBeFalse();
  });

  test("Print hands over a PDF as it is, unless it is rotated", async () => {
    const pdf = join(dir, "plain.pdf");
    const source: Source = { path: pdf, kind: "pdf", format: "pdf", stamp: { path: pdf, mtimeMs: 1, size: 3 }, turns: 0 };
    expect(await printablePdf(source, dir, all)).toBe(pdf);
    expect(await printablePdf({ ...source, turns: 2 }, dir, { magick: true, qpdf: false })).toBe(pdf);
  });
});

describe("the print dialog's answer", () => {
  const handle = "/org/freedesktop/portal/desktop/request/1_42/dashi_ab";
  const signal = (code: number, path = handle) => ({
    message: {
      type: MessageType.Signal,
      flags: 0,
      serial: 9,
      interface: "org.freedesktop.portal.Request",
      member: "Response",
      path,
      signature: "ua{sv}",
      body: [code, new Map()],
    },
    fds: [],
  });

  test("printed, cancelled, or failed; another request's answer is not ours", () => {
    expect(outcomeOf(0)).toBe("printed");
    expect(outcomeOf(1)).toBe("cancelled");
    expect(outcomeOf(2)).toBe("failed");
    expect(answerIn([signal(1, "/other")], handle, 3)).toBeNull();
    expect(answerIn([signal(0)], handle, 3)).toBe("printed");
    const error = answerIn(
      [{ message: { type: MessageType.Error, flags: 0, serial: 4, replySerial: 3, errorName: "x.Failed", signature: "s", body: ["no"] }, fds: [] }],
      handle,
      3,
    );
    expect(error).toBeInstanceOf(Error);
    expect(responseRule(handle)).toContain(`path='${handle}'`);
  });

  test("CUPS's default printer, by a name it could be", () => {
    expect(parseDefaultPrinter("system default destination: Office_Laser\n")).toBe("Office_Laser");
    expect(parseDefaultPrinter("no system default destination\n")).toBeNull();
    expect(parseDefaultPrinter("system default destination: -oops;rm\n")).toBeNull();
  });
});
