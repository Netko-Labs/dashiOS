/**
 * Save as PDF with a page range: the document cut to the pages asked for, by
 * `qpdf` (Apache-2.0, a separate program; dashi.spec recommends it), since a
 * printer does its own cutting and a file has nobody to do it. Without qpdf
 * the save fails and nothing is written: never every page under a name that
 * says some.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Runs qpdf with `args`; its stdout, or a throw when it isn't there or fails. */
export type RunQpdf = (args: readonly string[]) => Promise<string>;

async function qpdf(args: readonly string[]): Promise<string> {
  let child: ReturnType<typeof Bun.spawn>;
  try {
    child = Bun.spawn(["qpdf", ...args], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  } catch {
    throw new Error("a page range can't be saved as a PDF without qpdf");
  }
  const [out, problem, code] = await Promise.all([
    new Response(child.stdout as ReadableStream).text(),
    new Response(child.stderr as ReadableStream).text(),
    child.exited,
  ]);
  // 3 is "done, with warnings": the file is written.
  if (code !== 0 && code !== 3) throw new Error(`qpdf: ${problem.trim().split("\n")[0] ?? `exit ${code}`}`);
  return out;
}

/** `ranges` (1-based, inclusive) as qpdf writes them, kept within a document of `pages`: "1-3,5"; null when none of them is a page it has. */
export function qpdfRange(ranges: ReadonlyArray<readonly [number, number]>, pages: number): string | null {
  const kept = ranges
    .filter(([start]) => start <= pages)
    .map(([start, end]) => (Math.min(end, pages) === start ? `${start}` : `${start}-${Math.min(end, pages)}`));
  return kept.length > 0 ? kept.join(",") : null;
}

/** `pdf` with only the pages in `ranges`, in the order asked. */
export async function cutPages(pdf: Uint8Array, ranges: ReadonlyArray<readonly [number, number]>, run: RunQpdf = qpdf): Promise<Uint8Array> {
  const dir = mkdtempSync(join(process.env.XDG_RUNTIME_DIR || tmpdir(), "dashi-print-"));
  try {
    const whole = join(dir, "whole.pdf");
    const cut = join(dir, "cut.pdf");
    writeFileSync(whole, pdf, { mode: 0o600 });
    const pages = Number.parseInt(await run(["--show-npages", whole]), 10);
    const range = Number.isFinite(pages) ? qpdfRange(ranges, pages) : null;
    if (range === null) throw new Error("the document has none of those pages");
    await run(["--empty", "--pages", whole, range, "--", cut]);
    return new Uint8Array(readFileSync(cut));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
