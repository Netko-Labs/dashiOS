/**
 * The chrome row's plan, as state: what the toolbar's buttons do and show,
 * which tools fit the row (fold.ts measures it: the name, the size words, the
 * tools and "…"), the busy spinner, and the rows of "…"'s menu. The row
 * itself is toolbar.tsx's ToolbarRow.
 */

import { LOADING_DELAY_MS, MENU_SEPARATOR, type MenuEntry, useShownAfter, useTitleBarInset } from "@dashi/ui";
import { useMemo, useState } from "react";
import { detailChoices } from "../detail.ts";
import { planToolbar, type ToolbarPlan, type ToolId, toolWidths } from "../fold.ts";
import type { Snapshot } from "../snapshot.ts";
import { foldedItems, type ToolbarProps, toolsFor } from "../views/toolbar.tsx";
import { turned } from "../zoom.ts";
import type { WindowCommands } from "./use-actions.ts";
import type { Chrome } from "./use-chrome.ts";
import type { ZoomControls } from "./use-zoom.ts";

/** Work goes unshown this long (PA-5); past it, a spinner in the toolbar says Preview is on it. */
const BUSY_DELAY_MS = LOADING_DELAY_MS;

export interface ToolbarView {
  title: string;
  props: ToolbarProps;
  plan: ToolbarPlan;
  /** The tools drawn in the row, after the ones a file that can't be shown loses. */
  shown: ToolId[];
  busy: boolean;
  /** "…"'s rows: the tools that didn't fit, then the file's ways out. */
  moreItems: MenuEntry[];
  setRoom(width: number): void;
}

export function useToolbar({
  snap,
  page,
  zoomLabel,
  zoom,
  commands,
  hasPicture,
  isPdf,
  chrome,
}: {
  snap: Snapshot;
  /** The PDF's page in view. */
  page: number;
  zoomLabel: string;
  zoom: ZoomControls;
  commands: WindowCommands;
  hasPicture: boolean;
  isPdf: boolean;
  chrome: Chrome;
}): ToolbarView {
  const inset = useTitleBarInset();
  const [room, setRoom] = useState<number | null>(null);
  const { pdf } = snap;
  const { actions } = commands;
  const props: ToolbarProps = {
    canPrevious: commands.canPrevious,
    canNext: commands.canNext,
    onPrevious: () => commands.step(-1),
    onNext: () => commands.step(1),
    position: pdf ? `${page} / ${pdf.pages}` : null,
    zoomLabel,
    onZoomOut: zoom.out,
    onZoomIn: zoom.in,
    onFit: zoom.fit,
    onActual: zoom.actual,
    canTurn: snap.canTurn,
    onTurnLeft: () => actions.rotate(-1),
    onTurnRight: () => actions.rotate(1),
    onInfo: commands.showInfo,
    // Hung from "…": its right edge under the button's, at the width it is drawn (the menu keeps itself in the window).
    moreOpen: chrome.menu !== null,
    onMore: (bounds) => chrome.setMenu({ x: (bounds?.x ?? 0) + (bounds?.width ?? 32), y: (bounds?.y ?? 0) + (bounds?.height ?? 28) + 4 }),
    hasFile: snap.path !== null,
    hasPicture,
    unit: isPdf ? "Page" : "Image",
  };
  // A file that can't be shown keeps only what still means something: the way to its neighbours, and "…".
  const toolsNow = { failed: snap.phase === "error", canMove: commands.canPrevious || commands.canNext };
  const busy = useShownAfter(snap.busy || chrome.isWorking || pdf?.working === true, BUSY_DELAY_MS);
  const detail = useDetailChoices(snap);
  // The chrome row, measured: the name, the words, the tools and "…". The words give way first, then the name (to a
  // floor, with an ellipsis), and only then a tool, the least important first; nothing is cut at the edge (fold.ts).
  const title = snap.name || "Preview";
  const plan = planToolbar(room, {
    title: inset.unified ? title : null,
    widths: toolWidths({ position: props.position, zoomLevel: zoomLabel || null }),
    detail,
    busy,
  });
  const folded = foldedItems(toolsFor(plan.folded, toolsNow), props);
  // In groups, as the menu bar's File menu has them: the folded tools, then the file's ways out, Export and Print, Trash.
  const moreItems: MenuEntry[] = [
    ...folded,
    ...(folded.length > 0 ? [MENU_SEPARATOR] : []),
    { label: "Open With…", onPress: commands.openWithSheet, disabled: !snap.path || !snap.mime },
    { label: "Show in Files", onPress: () => actions.showInFiles(), disabled: !snap.path },
    MENU_SEPARATOR,
    { label: "Export…", keys: "⇧❖E", onPress: () => actions.exportFile(), disabled: commands.formats.length === 0 || !hasPicture },
    { label: "Print…", keys: "❖P", onPress: actions.print, disabled: !commands.canPrint || !hasPicture },
    MENU_SEPARATOR,
    { label: "Move to Trash…", keys: "⌫", onPress: () => chrome.setSheet({ kind: "trash" }), disabled: !snap.path },
  ];
  return { title, props, plan, shown: toolsFor(plan.shown, toolsNow), busy, moreItems, setRoom };
}

/** The picture's size and place in its folder, or a PDF's pages and title: the words the row may show (detail.ts). */
function useDetailChoices(snap: Snapshot): string[] {
  const pdfPages = snap.pdf?.pages ?? null;
  const pdfTitle = snap.pdf?.title ?? null;
  return useMemo(() => {
    if (!snap.path) return [];
    return detailChoices({
      size: snap.natural ? turned(snap.natural, snap.turns) : null,
      folder: { index: snap.folder.index, count: snap.folder.count },
      pdf: pdfPages !== null ? { pages: pdfPages, title: pdfTitle } : null,
    });
  }, [snap.path, snap.natural, snap.turns, snap.folder.index, snap.folder.count, pdfPages, pdfTitle]);
}
