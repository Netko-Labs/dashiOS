/**
 * What Preview's commands do outside the window: the file chooser's requests
 * (Open, and where an Export goes: Files' chooser as a sheet over the window,
 * R7), Open With, Show in Files, Move to Trash (at once, with Undo: PA-1,
 * PA-2), Copy, Export and Print. Each reports back through `say`, a notice
 * over the content's foot (VS-3, PA-6), so the window (view.tsx) only wires
 * them to menus, buttons and keys; sheets are kept for questions.
 */

import { homedir } from "node:os";
import { type ChooserRequest, chooserRequest, findTrashed, putBack, trashFilesDir, trashInfoDir } from "../../../src/shared/files/index.ts";
import { FORMATS } from "../../../src/shared/files/kinds.ts";
import type { Clipboard } from "../../kit/index.ts";
import { EXPORT_FORMATS, type ExportFormat } from "./convert.ts";
import { type Handler, handlersFor, moveToTrash, openWith, showInFiles } from "./handlers.ts";
import { MESSAGES } from "./messages.ts";
import { exportFile, exportName, type OutputTools, PAGE_DPI, pagePng, pictureMime, printablePdf, type Source } from "./output.ts";
import { defaultPrinter, printWithCups, printWithPortal } from "./print.ts";
import type { Snapshot } from "./snapshot.ts";
import type { Viewer } from "./viewer.ts";

/** What File › Open… lists: every kind Preview names (the viewer checks the bytes). */
const OPENABLE = [...new Set(Object.values(FORMATS).map((format) => format.mime))];
export const SELF_ID = "dev.dashi.preview.desktop";
const APP_ID = "dev.dashi.preview";

/** How a notice reads: an error in ume, or a note that fades; `undo` puts an Undo button on it. */
export type Say = (text: string, tone?: "error" | "info", undo?: () => void) => void;

export interface CommandHooks {
  viewer: Viewer;
  board: Clipboard;
  /** The cache folder, for the copies output makes. */
  root: string;
  /** One plain sentence or two over the content's foot (AppWindow's notice). */
  say: Say;
  /** Something is being made for the person (an export, a page to print): the toolbar shows it. */
  working(on: boolean): void;
}

/** The open file as output needs it, or null with nothing (whole) open. */
export function sourceOf(snap: Snapshot): Source | null {
  const { path, kind, format, stamp, turns } = snap;
  return path && kind && format && stamp ? { path, kind, format, stamp, turns } : null;
}

export const toolsOf = (snap: Snapshot): OutputTools => ({ magick: snap.tools.magick, qpdf: snap.tools.qpdf });

/** The home folder as the session gives it ($HOME), as Files' chooser takes it. */
const home = (): string => process.env.HOME || homedir();

/** File › Open…: Files' chooser over the window, in the open file's folder (or home), for pictures and PDFs. */
export function openRequest(snap: Snapshot): ChooserRequest {
  return chooserRequest("open", {
    appId: APP_ID,
    title: "Open",
    currentFolder: snap.folder.dir || home(),
    filters: [{ name: "Pictures and PDFs", patterns: OPENABLE.map((pattern) => ({ kind: "mime" as const, pattern })) }],
  });
}

/** Export's "where to": the chooser in save mode, beside the open file, with the copy's name and kind. */
export function exportRequest(snap: Snapshot, choice: { format: ExportFormat }, page: number): ChooserRequest {
  const source = sourceOf(snap);
  const asPage = source?.kind === "pdf" && choice.format !== "pdf";
  const kind = EXPORT_FORMATS[choice.format];
  return chooserRequest("save", {
    appId: APP_ID,
    title: "Export",
    currentFolder: snap.folder.dir || home(),
    currentName: exportName(snap.name, choice.format, asPage ? page : null),
    filters: [{ name: kind.label, patterns: [{ kind: "mime", pattern: kind.mime }] }],
  });
}

export async function appsFor(snap: Snapshot): Promise<Handler[]> {
  return snap.mime ? handlersFor(snap.mime, [SELF_ID]) : [];
}

export function launchWith(hooks: CommandHooks, handler: Handler, path: string): void {
  void openWith(handler, path).then((ok) => ok || hooks.say(`${handler.name} didn’t open it. The app couldn’t be started with this file.`));
}

export function reveal(hooks: CommandHooks, dir: string): void {
  void showInFiles(dir).then((ok) => ok || hooks.say("Files didn’t open. Open the folder from Files instead."));
}

/**
 * Move the open file to the Trash at once (it can be put back, so nothing
 * asks: PA-1), show the next picture in its folder (or nothing), and say so
 * with Undo, which puts it back and opens it again (PA-2).
 */
export function trash(hooks: CommandHooks, snap: Snapshot): void {
  const { path, folder, kind, name } = snap;
  if (!path) return;
  const next = folder.next ?? folder.previous;
  void moveToTrash(path).then((error) => {
    if (error !== null) return hooks.say(`Couldn’t move “${name}” to the Trash. ${MESSAGES.trashFailed}`);
    if (next && kind === "image") void hooks.viewer.open(`${folder.dir}/${next}`, { recent: false });
    else hooks.viewer.clear();
    hooks.say(`Moved “${name}” to the Trash.`, "info", () => void putBackTrashed(hooks, path));
    return undefined;
  });
}

/** Undo of Move to Trash: the newest item in the Trash that came from `path`, put back and opened. */
async function putBackTrashed(hooks: CommandHooks, path: string): Promise<void> {
  const places = { files: trashFilesDir(), info: trashInfoDir() };
  try {
    const trashed = await findTrashed(path, places);
    if (trashed === null) return hooks.say(MESSAGES.notInTrash);
    await hooks.viewer.open(await putBack(trashed, places, home()));
  } catch {
    hooks.say(MESSAGES.notInTrash);
  }
}

export function copyPath(hooks: CommandHooks, path: string | null): void {
  if (!path) return;
  void hooks.board.writeText(path).then((ok) => ok || hooks.say(MESSAGES.clipboard));
}

/**
 * Copy: the selected text when a PDF has some, else what is on screen as a
 * picture (the picture, or the PDF's page in view).
 */
export async function copy(hooks: CommandHooks, snap: Snapshot, selectedText: (() => Promise<string>) | null, page: number): Promise<void> {
  const fail = (): void => hooks.say(MESSAGES.clipboard);
  if (selectedText) {
    const text = await selectedText();
    if (text !== "") {
      if (!(await hooks.board.writeText(text))) fail();
      return;
    }
  }
  const source = sourceOf(snap);
  const write = hooks.board.writeFile;
  if (!source || !write) return fail();
  if (snap.picture) {
    if (!(await write(snap.picture.source, pictureMime(snap.picture.source, source.path, source.format)))) fail();
    return;
  }
  hooks.working(true);
  try {
    const png = source.kind === "pdf" ? await pagePng(source, page, PAGE_DPI, hooks.root) : null;
    if (!png || !(await write(png, "image/png"))) fail();
  } finally {
    hooks.working(false);
  }
}

/** Export: the copy written where the chooser said (`target`, exportRequest). */
export async function exportTo(
  hooks: CommandHooks,
  snap: Snapshot,
  choice: { format: ExportFormat; quality: number },
  page: number,
  target: string,
): Promise<void> {
  const source = sourceOf(snap);
  if (!source) return;
  hooks.working(true);
  try {
    const result = await exportFile(source, { to: choice.format, quality: choice.quality, page, target }, hooks.root, toolsOf(snap));
    if (!result.ok) hooks.say(`Not exported. ${MESSAGES.exportFailed}`);
    else if (result.unrotated) hooks.say(`Exported without the rotation. ${MESSAGES.exportUnrotated}`, "info");
  } finally {
    hooks.working(false);
  }
}

/**
 * Print: the print dialog through the portal; without one, CUPS's default
 * printer, after `confirm` asks. Returns once the dialog answered.
 */
export async function print(hooks: CommandHooks, snap: Snapshot, confirm: (printer: string, pdf: string) => void): Promise<void> {
  const source = sourceOf(snap);
  if (!source) return;
  hooks.working(true);
  let pdf: string | null;
  try {
    pdf = await printablePdf(source, hooks.root, toolsOf(snap));
  } finally {
    hooks.working(false);
  }
  if (!pdf) return hooks.say(`Can’t print this. ${MESSAGES.damaged}`);
  try {
    const outcome = await printWithPortal(pdf, snap.name);
    if (outcome === "failed") hooks.say(`Not printed. ${MESSAGES.printFailed}`);
    return;
  } catch {
    // No portal: CUPS itself.
  }
  const printer = await defaultPrinter();
  if (!printer) return hooks.say(`Can’t print. ${MESSAGES.noPrinting}`);
  confirm(printer, pdf);
}

export function printOn(hooks: CommandHooks, printer: string, pdf: string, title: string): void {
  void printWithCups(pdf, title, printer).then((ok) => ok || hooks.say(`Not printed. ${MESSAGES.printFailed}`));
}
