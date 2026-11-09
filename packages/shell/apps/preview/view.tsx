/**
 * Preview's window: the toolbar, the page strip in the sidebar, the picture
 * or the PDF's scrolling pages, and the sheets. The state that is slow
 * (files, tools) is the Viewer's; what lives here is how it is looked at
 * (picture-view.ts, document.ts), which sheet is up, and the keys (keys.ts).
 * A file dropped anywhere on the window opens in it (drop.ts); with no file
 * open, the window offers only that, Open… and the recent files.
 */

import {
  AppWindow,
  LOADING_DELAY_MS,
  Loading,
  MENU_SEPARATOR,
  type MenuEntry,
  PopupMenu,
  Spinner,
  useColors,
  useShownAfter,
  useSurface,
  useTitleBarInset,
} from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { useMemo, useState, useSyncExternalStore } from "react";
import { type Clipboard, systemClipboard, useAppMenus } from "../kit/index.ts";
import { cacheRoot } from "./cache.ts";
import { Canvas } from "./canvas.tsx";
import * as commands from "./commands.ts";
import { DETAIL_SIZE, detailChoices } from "./detail.ts";
import { LINE_PX, PDF_UNIT, useDocument } from "./document.ts";
import { useDropArea } from "./drop.ts";
import { MEASURES, planToolbar, toolWidths } from "./fold.ts";
import { type KeyAction, keyAction } from "./keys.ts";
import { previewMenus } from "./menus.ts";
import { exportFormats } from "./output.ts";
import { PreviewSheet, type SheetState } from "./overlay.tsx";
import { usePictureView } from "./picture-view.ts";
import { EmptyView, ErrorView } from "./states.tsx";
import { STRIP, Strip, type StripItem, stripWidth, UNKNOWN_SHAPE } from "./strip.tsx";
import { DocumentSurface } from "./surface.tsx";
import { foldedItems, PreviewToolbar, type ToolbarProps, toolsFor } from "./toolbar.tsx";
import type { Viewer } from "./viewer.ts";
import { FIT, percent, turned } from "./zoom.ts";

export const PREVIEW_SIZE = { width: 1000, height: 700 } as const;
/** The least the window gets: a picture, the name, Previous and Next, and "…" still fit (fold.ts). */
export const PREVIEW_MIN_SIZE = { width: 360, height: 280 } as const;
/** Work goes unshown this long (PA-5); past it, a spinner in the toolbar says Preview is on it. */
const BUSY_DELAY_MS = LOADING_DELAY_MS;

export function PreviewWindow({ viewer, clipboard, cacheDir }: { viewer: Viewer; clipboard?: Clipboard; cacheDir?: string }) {
  const colors = useColors();
  const surface = useSurface();
  const [board] = useState<Clipboard>(() => clipboard ?? systemClipboard());
  const snap = useSyncExternalStore(viewer.subscribe, viewer.getSnapshot);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  // The strip: shown or hidden by the person (View ▸ Sidebar), or, until they choose, by the window's width (strip.tsx).
  const [sidebarChoice, setSidebarChoice] = useState<boolean | null>(null);
  const [windowWidth, setWindowWidth] = useState<number | null>(null);
  const autoWidth = stripWidth(windowWidth);
  const sidebar = sidebarChoice ?? autoWidth > 0;
  const sidebarWidth = autoWidth > 0 ? autoWidth : STRIP.least;
  const inset = useTitleBarInset();
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
    if (!snap.path || !snap.mime) return;
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
    copy: () => void commands.copy(hooks, snap, doc.hasSelection() ? doc.copyText : null, doc.page),
    selectAll: () => doc.selectAll(),
    copyPath: () => commands.copyPath(hooks, snap.path),
    actualSize: zoom.actual,
    zoomIn: zoom.in,
    zoomOut: zoom.out,
    zoomToFit: zoom.fit,
    zoomToWidth: zoom.width,
    toggleSidebar: () => setSidebarChoice(!sidebar),
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
    // Hung from "…": its right edge under the button's, at the width it is drawn (the menu keeps itself in the window).
    onMore: (bounds) => setMenu({ x: (bounds?.x ?? 0) + (bounds?.width ?? 32), y: (bounds?.y ?? 0) + (bounds?.height ?? 28) + 4 }),
    hasFile: snap.path !== null,
    hasPicture,
    unit: isPdf ? "Page" : "Image",
  };
  // A file that can't be shown keeps only what still means something: the way to its neighbours, and "…".
  const toolsNow = { failed: snap.phase === "error", canMove: canPrevious || canNext };
  const busy = useShownAfter(snap.busy || working > 0 || pdf?.working === true, BUSY_DELAY_MS);

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
  // The chrome row, measured: the name, the words, the tools and "…". The words give way first, then the name (to a
  // floor, with an ellipsis), and only then a tool, the least important first; nothing is cut at the edge (fold.ts).
  const [room, setRoom] = useState<number | null>(null);
  const title = snap.name || "Preview";
  const plan = planToolbar(room, {
    title: inset.unified ? title : null,
    widths: toolWidths({ position: toolbarProps.position, zoomLevel: zoomLabel || null }),
    detail: detailChoicesNow,
    busy,
  });
  const folded = foldedItems(toolsFor(plan.folded, toolsNow), toolbarProps);
  // In groups, as the menu bar's File menu has them: the folded tools, then the file's ways out, Export and Print, Trash.
  const moreItems: MenuEntry[] = [
    ...folded,
    ...(folded.length > 0 ? [MENU_SEPARATOR] : []),
    { label: "Open With…", onPress: openWithSheet, disabled: !snap.path || !snap.mime },
    { label: "Show in Files", onPress: () => actions.showInFiles(), disabled: !snap.path },
    MENU_SEPARATOR,
    { label: "Export…", keys: "⇧❖E", onPress: () => actions.exportFile(), disabled: formats.length === 0 || !hasPicture },
    { label: "Print…", keys: "❖P", onPress: actions.print, disabled: !canPrint || !hasPicture },
    MENU_SEPARATOR,
    { label: "Move to Trash…", keys: "⌫", onPress: () => setSheet({ kind: "trash" }), disabled: !snap.path },
  ];

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
    () =>
      snap.folder.files.map((name) => ({
        key: name,
        label: name,
        source: snap.folderThumbs.get(name) ?? null,
        // Each picture at its own shape once its thumbnail is made: a panorama is a band, a portrait is tall.
        shape: snap.folderShapes.get(name) ?? UNKNOWN_SHAPE,
      })),
    [snap.folder.files, snap.folderThumbs, snap.folderShapes],
  );
  const strip = pdf ? (
    <Strip
      testID="strip"
      items={pdfItems}
      current={doc.page - 1}
      onPick={(index) => doc.goToPage(index + 1)}
      onVisible={(rows) => doc.setStripPages(rows.map((row) => row + 1))}
      width={sidebarWidth}
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
      width={sidebarWidth}
    />
  ) : null;

  const overlay =
    sheet !== null ? (
      <PreviewSheet sheet={sheet} snap={snap} page={doc.page} hooks={hooks} onClose={() => setSheet(null)} />
    ) : menu ? (
      <PopupMenu testID="more-menu" x={menu.x} y={menu.y} anchor="end" items={moreItems} onClose={() => setMenu(null)} />
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
      <ErrorView name={snap.name} message={snap.error ?? ""} onOpenWith={snap.mime ? openWithSheet : null} onOpen={actions.open} />
    ) : snap.phase === "loading" ? (
      <Loading testID="loading" label={`Opening “${snap.name}”…`} />
    ) : (
      <EmptyView recents={snap.recents} onOpen={actions.open} onRecent={actions.openRecent} />
    );

  return (
    <AppWindow
      title={title}
      center={
        // The whole row after the window controls, measured (from a zero basis, so what it holds never moves it):
        // the name, then the words and the tools that fit what it leaves, whole: never "320 × 18…", never a button
        // cut at the edge, never the name under "…".
        <View
          testID="toolbar-room"
          onLayout={(bounds) => setRoom(bounds.width)}
          style={{
            flex: 1,
            minWidth: 0,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: plan.title > 0 ? "space-between" : "flex-end",
            gap: MEASURES.gap,
          }}
        >
          {plan.title > 0 && (
            <View testID="title" style={{ flexShrink: 0, maxWidth: plan.title }}>
              <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: "bold", color: colors.text }}>
                {title}
              </Text>
            </View>
          )}
          <View style={{ flexShrink: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: MEASURES.gap }}>
            {busy && <Spinner testID="busy" size={16} />}
            {plan.detail !== null && (
              <View testID="detail" style={{ flexShrink: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ fontSize: DETAIL_SIZE, color: colors.textMuted }}>
                  {plan.detail}
                </Text>
              </View>
            )}
            <PreviewToolbar {...toolbarProps} shown={toolsFor(plan.shown, toolsNow)} />
          </View>
        </View>
      }
      // Present, if empty, so the row is there with the compositor's own title bar too.
      toolbar={null}
      sidebar={strip && sidebar ? strip : undefined}
      sidebarWidth={sidebarWidth}
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
        // The window's width (this area and the strip beside it), for the strip's own width.
        onLayout={(bounds) => setWindowWidth(Math.round(bounds.width + (strip && sidebar ? sidebarWidth : 0)))}
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
