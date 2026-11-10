/**
 * What the window's commands do, once: open, the file's ways out (Show in
 * Files, Open With, Export, Print, Trash), copy, zoom, sidebar, rotate and
 * step. The menu bar (menus.ts), the keys (use-keys.ts), the toolbar and the
 * sheets all run these; the commands themselves are commands.ts's.
 */

import type { Clipboard } from "../kit/index.ts";
import { cacheRoot } from "./cache.ts";
import * as commands from "./commands.ts";
import type { DocumentView } from "./document.ts";
import type { PreviewMenuContext } from "./menus.ts";
import { exportFormats } from "./output.ts";
import type { Snapshot } from "./snapshot.ts";
import type { Chrome } from "./use-chrome.ts";
import type { ZoomControls } from "./use-zoom.ts";
import type { Viewer } from "./viewer.ts";

export type MenuActions = PreviewMenuContext["actions"];

export interface WindowCommands {
  hooks: commands.CommandHooks;
  actions: MenuActions;
  canPrevious: boolean;
  canNext: boolean;
  formats: ReturnType<typeof exportFormats>;
  canPrint: boolean;
  openWithSheet(): void;
  showInfo(): void;
  step(delta: 1 | -1): void;
}

export function useActions({
  viewer,
  board,
  cacheDir,
  snap,
  doc,
  zoom,
  hasPicture,
  chrome,
}: {
  viewer: Viewer;
  board: Clipboard;
  cacheDir: string | undefined;
  snap: Snapshot;
  doc: DocumentView;
  zoom: ZoomControls;
  hasPicture: boolean;
  chrome: Chrome;
}): WindowCommands {
  const { pdf } = snap;
  const isPdf = snap.kind === "pdf";
  // Previous and next: a PDF's pages, or the folder's pictures.
  const canPrevious = pdf ? doc.page > 1 : snap.folder.previous !== null;
  const canNext = pdf ? doc.page < pdf.pages : snap.folder.next !== null;
  const say = (title: string, message: string): void => chrome.setSheet({ kind: "message", title, message });
  const hooks: commands.CommandHooks = {
    viewer,
    board,
    root: cacheDir ?? cacheRoot(),
    say,
    working: chrome.working,
  };
  // Moving: a PDF's pages, or the folder's pictures.
  const step = (delta: 1 | -1): void => {
    if (pdf) doc.goToPage(doc.page + delta);
    else void viewer.step(delta);
  };
  const showInfo = (): void => {
    if (hasPicture) chrome.setSheet({ kind: "info" });
  };
  const openWithSheet = (): void => {
    if (!snap.path || !snap.mime) return;
    chrome.setSheet({ kind: "open-with", handlers: null });
    void commands.appsFor(snap).then((handlers) => chrome.setSheet((now) => (now?.kind === "open-with" ? { kind: "open-with", handlers } : now)));
  };
  const formats = exportFormats(snap.kind, snap.format, commands.toolsOf(snap));
  const canPrint = commands.sourceOf(snap) !== null && (isPdf || snap.tools.magick) && formats.length > 0;
  const actions: MenuActions = {
    open: () => commands.openFile(hooks),
    openRecent: (path: string) => void viewer.open(path),
    clearRecents: () => viewer.forgetRecents(),
    openWith: openWithSheet,
    showInFiles: () => snap.path && commands.reveal(hooks, snap.folder.dir || snap.facts?.folder || ""),
    exportFile: () => formats.length > 0 && chrome.setSheet({ kind: "export", formats }),
    print: () => void commands.print(hooks, snap, (printer, file) => chrome.setSheet({ kind: "print-cups", printer, pdf: file })),
    info: showInfo,
    trash: () => snap.path && chrome.setSheet({ kind: "trash" }),
    copy: () => void commands.copy(hooks, snap, doc.hasSelection() ? doc.copyText : null, doc.page),
    selectAll: () => doc.selectAll(),
    copyPath: () => commands.copyPath(hooks, snap.path),
    actualSize: zoom.actual,
    zoomIn: zoom.in,
    zoomOut: zoom.out,
    zoomToFit: zoom.fit,
    zoomToWidth: zoom.width,
    toggleSidebar: chrome.toggleSidebar,
    rotate: (direction: 1 | -1) => void viewer.rotate(direction),
    step,
  };
  return { hooks, actions, canPrevious, canNext, formats, canPrint, openWithSheet, showInfo, step };
}
