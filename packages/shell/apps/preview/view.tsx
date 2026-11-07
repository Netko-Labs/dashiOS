/**
 * Preview's window: the toolbar, the page strip in the sidebar, the picture
 * or the PDF's scrolling pages, and the sheets. The state that is slow
 * (files, tools) is the Viewer's; what lives here is how it is looked at
 * (picture-view.ts, document.ts), which sheet is up, and the keys (keys.ts).
 * A file dropped anywhere on the window opens in it (drop.ts); with no file
 * open, the window offers only that, Open… and the recent files.
 */

import { AppWindow, Loading, type MenuItem, PopupMenu, Spinner, useColors, useShownAfter, useSurface } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { useMemo, useState, useSyncExternalStore } from "react";
import { type Clipboard, systemClipboard, useAppMenus } from "../kit/index.ts";
import { cacheRoot } from "./cache.ts";
import { Canvas } from "./canvas.tsx";
import * as commands from "./commands.ts";
import { DETAIL_SIZE, detailChoices, fitDetail } from "./detail.ts";
import { LINE_PX, PDF_UNIT, useDocument } from "./document.ts";
import { useDropArea } from "./drop.ts";
import { foldTools, MEASURES, toolWidths } from "./fold.ts";
import { type KeyAction, keyAction } from "./keys.ts";
import { previewMenus } from "./menus.ts";
import { exportFormats } from "./output.ts";
import { PreviewSheet, type SheetState } from "./overlay.tsx";
import { usePictureView } from "./picture-view.ts";
import { EmptyView, ErrorView } from "./states.tsx";
import { Strip, type StripItem } from "./strip.tsx";
import { DocumentSurface } from "./surface.tsx";
import { foldedItems, PreviewToolbar, type ToolbarProps } from "./toolbar.tsx";
import type { Viewer } from "./viewer.ts";
import { FIT, percent, turned } from "./zoom.ts";

export const PREVIEW_SIZE = { width: 1000, height: 700 } as const;
/** Work goes unshown this long; past it, a spinner in the toolbar says Preview is on it. */
const BUSY_DELAY_MS = 300;

export function PreviewWindow({ viewer, clipboard, cacheDir }: { viewer: Viewer; clipboard?: Clipboard; cacheDir?: string }) {
  const colors = useColors();
  const surface = useSurface();
  const [board] = useState<Clipboard>(() => clipboard ?? systemClipboard());
  const snap = useSyncExternalStore(viewer.subscribe, viewer.getSnapshot);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [sidebar, setSidebar] = useState(true);
  const [working, setWorking] = useState(0);

  const { picture, pdf } = snap;
  const isPdf = snap.kind === "pdf";
  const pictureView = usePictureView(picture, snap.path, snap.turns);
  const doc = useDocument(viewer, pdf, snap.turns, snap.path);
  const hasPicture = picture !== null || (pdf !== null && snap.phase === "ready");

  const say = (title: string, message: string): void => setSheet({ kind: "message", title, message });
  const hooks: commands.CommandHooks = {
    viewer,
    board,
    root: cacheDir ?? cacheRoot(),
    say,
    working: (on) => setWorking((now) => Math.max(0, now + (on ? 1 : -1))),
  };

  // Moving: a PDF's pages, or the folder's pictures.
  const step = (delta: 1 | -1): void => {
    if (pdf) doc.goToPage(doc.page + delta);
    else void viewer.step(delta);
  };
  const canPrevious = pdf ? doc.page > 1 : snap.folder.previous !== null;
  const canNext = pdf ? doc.page < pdf.pages : snap.folder.next !== null;

  // Zooming, the same words for both.
  const zoom = {
    in: () => (pdf ? doc.stepZoom(1) : pictureView.stepZoom(1)),
    out: () => (pdf ? doc.stepZoom(-1) : pictureView.stepZoom(-1)),
    fit: () => (pdf ? doc.zoomTo({ kind: "fit" }) : pictureView.zoomTo(FIT)),
    actual: () => (pdf ? doc.zoomTo({ kind: "scale", scale: PDF_UNIT }) : pictureView.zoomTo({ kind: "scale", scale: 1 })),
    width: () => doc.zoomTo({ kind: "width" }),
  };
  const zoomLabel = pdf ? percent(doc.scale / PDF_UNIT) : picture ? percent(pictureView.scale) : "";

  const showInfo = (): void => {
    if (hasPicture) setSheet({ kind: "info" });
  };
  const openWithSheet = (): void => {
    if (!snap.path || !snap.format) return;
    setSheet({ kind: "open-with", handlers: null });
    void commands.appsFor(snap).then((handlers) => setSheet((now) => (now?.kind === "open-with" ? { kind: "open-with", handlers } : now)));
  };
  const formats = exportFormats(snap.kind, snap.format, commands.toolsOf(snap));
  const canPrint = commands.sourceOf(snap) !== null && (isPdf || snap.tools.magick) && formats.length > 0;
  const actions = {
    open: () => commands.openFile(hooks),
    openRecent: (path: string) => void viewer.open(path),
    clearRecents: () => viewer.forgetRecents(),
    openWith: openWithSheet,
    showInFiles: () => snap.path && commands.reveal(hooks, snap.folder.dir || snap.facts?.folder || ""),
    exportFile: () => formats.length > 0 && setSheet({ kind: "export", formats }),
    print: () => void commands.print(hooks, snap, (printer, file) => setSheet({ kind: "print-cups", printer, pdf: file })),
    info: showInfo,
    trash: () => snap.path && setSheet({ kind: "trash" }),
    copy: () => void commands.copy(hooks, snap, doc.range ? doc.copyText : null, doc.page),
    selectAll: () => doc.selectAll(),
    copyPath: () => commands.copyPath(hooks, snap.path),
    actualSize: zoom.actual,
    zoomIn: zoom.in,
    zoomOut: zoom.out,
    zoomToFit: zoom.fit,
    zoomToWidth: zoom.width,
    toggleSidebar: () => setSidebar((now) => !now),
    rotate: (direction: 1 | -1) => void viewer.rotate(direction),
    step,
  };

  const onKey = (action: KeyAction): void => {
    switch (action.kind) {
      case "scroll":
        return doc.scrollBy(0, action.direction * (action.by === "line" ? 2 * LINE_PX : Math.max(40, doc.area.height - 40)));
      case "end":
        return doc.scrollToTop(action.direction < 0 ? 0 : Number.MAX_SAFE_INTEGER);
      case "step":
        return step(action.direction);
      case "trash":
        actions.trash();
        return;
      case "unselect":
        return doc.select(null);
    }
  };

  // The menu bar's menus (src/app-menus/), with the keys they show.
  const { menus, run } = previewMenus({
    hasFile: snap.path !== null,
    hasPicture,
    isPdf,
    canTurn: snap.canTurn,
    canPrevious,
    canNext,
    canCopy: board.canWrite,
    hasSelection: doc.range !== null,
    canExport: formats.length > 0,
    canPrint,
    sidebar,
    recents: snap.recents.map((recent) => recent.path),
    blocked: sheet !== null || menu !== null,
    actions,
  });
  useAppMenus(menus, run);

  const toolbarProps: ToolbarProps = {
    canPrevious,
    canNext,
    onPrevious: () => step(-1),
    onNext: () => step(1),
    position: pdf ? `${doc.page} / ${pdf.pages}` : null,
    zoomLabel,
    onZoomOut: zoom.out,
    onZoomIn: zoom.in,
    onFit: zoom.fit,
    onActual: zoom.actual,
    canTurn: snap.canTurn,
    onTurnLeft: () => actions.rotate(-1),
    onTurnRight: () => actions.rotate(1),
    onInfo: showInfo,
    // Hung from "…"'s right edge (the menu keeps itself in the window).
    onMore: (bounds) => setMenu({ x: Math.max((bounds?.x ?? 0) + (bounds?.width ?? 32) - 220, 8), y: (bounds?.y ?? 0) + (bounds?.height ?? 28) + 4 }),
    hasFile: snap.path !== null,
    hasPicture,
    unit: isPdf ? "Page" : "Image",
  };
  // The toolbar's room, measured: what doesn't fit folds into "…", the least important first, never cut at the edge (fold.ts).
  const [room, setRoom] = useState<number | null>(null);
  const fold = foldTools(room, toolWidths({ position: toolbarProps.position, zoomLevel: zoomLabel || null }));
  const busy = useShownAfter(snap.busy || working > 0 || pdf?.working === true, BUSY_DELAY_MS);

  const moreItems: MenuItem[] = [
    ...foldedItems(fold.folded, toolbarProps),
    { label: "Open With…", onPress: openWithSheet, disabled: !snap.path || !snap.format },
    { label: "Show in Files", onPress: () => actions.showInFiles(), disabled: !snap.path },
    { label: "Export…", keys: "⇧❖E", onPress: () => actions.exportFile(), disabled: formats.length === 0 || !hasPicture },
    { label: "Print…", keys: "❖P", onPress: actions.print, disabled: !canPrint || !hasPicture },
    { label: "Move to Trash…", keys: "⌫", onPress: () => setSheet({ kind: "trash" }), disabled: !snap.path },
  ];

  // The picture's size and place in its folder: a quiet line in the toolbar row, not a second line under the title.
  // A narrow window drops the folder place before it would cut the size (detail.ts).
  const pdfPages = pdf?.pages ?? null;
  const pdfTitle = pdf?.title ?? null;
  const detailChoicesNow = useMemo(() => {
    if (!snap.path) return [];
    return detailChoices({
      size: snap.natural ? turned(snap.natural, snap.turns) : null,
      folder: { index: snap.folder.index, count: snap.folder.count },
      pdf: pdfPages !== null ? { pages: pdfPages, title: pdfTitle } : null,
    });
  }, [snap.path, snap.natural, snap.turns, snap.folder.index, snap.folder.count, pdfPages, pdfTitle]);
  // The words get what the tools (and the spinner) leave; they give way before any tool folds.
  const detail = fitDetail(detailChoicesNow, room === null ? 0 : room - fold.width - MEASURES.gap - (busy ? 16 + MEASURES.gap : 0));

  // The page strip: a PDF's pages, or the pictures in the open one's folder.
  const pdfItems = useMemo<StripItem[]>(
    () =>
      pdf
        ? pdf.sizes.map((size, index) => ({
            key: String(index + 1),
            label: String(index + 1),
            source: pdf.thumbs.get(index + 1) ?? null,
            shape: size.height / size.width,
          }))
        : [],
    [pdf],
  );
  const folderItems = useMemo<StripItem[]>(
    () => snap.folder.files.map((name) => ({ key: name, label: name, source: snap.folderThumbs.get(name) ?? null, shape: 0.75 })),
    [snap.folder.files, snap.folderThumbs],
  );
  const strip = pdf ? (
    <Strip
      testID="strip"
      items={pdfItems}
      current={doc.page - 1}
      onPick={(index) => doc.goToPage(index + 1)}
      onVisible={(rows) => doc.setStripPages(rows.map((row) => row + 1))}
    />
  ) : snap.kind === "image" && snap.folder.count > 1 ? (
    <Strip
      testID="strip"
      items={folderItems}
      current={snap.folder.index}
      onPick={(index) => {
        const name = snap.folder.files[index];
        if (name) void viewer.openSibling(name);
      }}
      onVisible={(rows) => viewer.wantFolderThumbs(rows.map((row) => snap.folder.files[row]).filter((name): name is string => name !== undefined))}
    />
  ) : null;

  const overlay =
    sheet !== null ? (
      <PreviewSheet sheet={sheet} snap={snap} page={doc.page} hooks={hooks} onClose={() => setSheet(null)} />
    ) : menu ? (
      <PopupMenu testID="more-menu" x={menu.x} y={menu.y} items={moreItems} onClose={() => setMenu(null)} />
    ) : undefined;

  const drop = useDropArea((path) => {
    setSheet(null);
    setMenu(null);
    void viewer.open(path);
  });

  const content =
    pdf && snap.phase === "ready" ? (
      <DocumentSurface pdf={pdf} doc={doc} turns={snap.turns} ground={surface.canvas} />
    ) : picture ? (
      <Canvas
        picture={picture}
        scale={pictureView.scale}
        pan={pictureView.pan}
        onPan={pictureView.setPan}
        onArea={pictureView.setArea}
        area={pictureView.area}
        ground={surface.canvas}
      />
    ) : snap.phase === "error" ? (
      <ErrorView name={snap.name} message={snap.error ?? ""} onOpenWith={snap.format ? openWithSheet : null} onOpen={actions.open} />
    ) : snap.phase === "loading" ? (
      <Loading testID="loading" label={`Opening “${snap.name}”…`} />
    ) : (
      <EmptyView recents={snap.recents} onOpen={actions.open} onRecent={actions.openRecent} />
    );

  return (
    <AppWindow
      title={snap.name || "Preview"}
      toolbar={
        // The room left in the row (from a zero basis it takes nearly all the free space: `flex: 100` beside the
        // window's own spacer), measured: the tools that fit it, then the words that fit what they leave, whole:
        // never "320 × 18…", never a button cut at the edge.
        <View
          testID="toolbar-room"
          onLayout={(bounds) => setRoom(bounds.width)}
          style={{ flex: 100, minWidth: 0, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: MEASURES.gap }}
        >
          {busy && <Spinner testID="busy" size={16} />}
          {detail !== null && (
            <View testID="detail" style={{ flexShrink: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontSize: DETAIL_SIZE, color: colors.textMuted }}>
                {detail}
              </Text>
            </View>
          )}
          <PreviewToolbar {...toolbarProps} shown={fold.shown} />
        </View>
      }
      sidebar={strip && sidebar ? strip : undefined}
      overlay={overlay}
    >
      {sheet === null && menu === null && (
        <View
          testID="keys"
          onWindowKeyDown={(key) => {
            const action = keyAction(key, isPdf);
            if (action) onKey(action);
          }}
          style={{ position: "absolute", left: 0, top: 0, width: 0, height: 0 }}
        />
      )}
      <View
        testID="drop-area"
        onDrop={drop.onDrop}
        style={{ flex: 1, flexDirection: "column", minHeight: 0, minWidth: 0, position: "relative", backgroundColor: surface.canvas }}
      >
        {content}
        {drop.over && (
          <View
            testID="drop-target"
            style={{ position: "absolute", left: 4, top: 4, right: 4, bottom: 4, borderWidth: 2, borderColor: colors.selection, borderRadius: 8 }}
          />
        )}
      </View>
    </AppWindow>
  );
}
