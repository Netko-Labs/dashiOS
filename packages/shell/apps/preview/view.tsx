/**
 * Preview's window: the toolbar, the picture area, the PDF's page strip, and
 * the sheets. The state that is slow (files, tools) is the Viewer's; what
 * lives here is how the picture is looked at: the zoom, the pan, which sheet
 * is up, and the keys.
 */

import { AppWindow, Button, ConfirmSheet, EmptyState, type KeyInput, KeySink, type MenuItem, PopupMenu, useColors } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { chooseFile } from "../../src/portal/file-chooser.ts";
import { type Clipboard, systemClipboard, useAppMenus } from "../kit/index.ts";
import { Canvas } from "./canvas.tsx";
import type { Size } from "./dimensions.ts";
import * as glyphs from "./glyphs.ts";
import { type Handler, handlersFor, moveToTrash, openWith, showInFiles } from "./handlers.ts";
import { factsFor } from "./info.ts";
import { FORMATS } from "./kinds.ts";
import { previewMenus } from "./menus.ts";
import { type InfoRow, InfoSheet, imageRows, infoRows, MessageSheet, OpenWithSheet } from "./sheets.tsx";
import { Thumbnails } from "./thumbnails.tsx";
import { PreviewToolbar } from "./toolbar.tsx";
import type { Viewer } from "./viewer.ts";
import { clampPan, FIT, fitScale, type Pan, panAfterZoom, percent, scaled, scaleOf, turned, type ZoomMode, zoomIn, zoomOut } from "./zoom.ts";

export const PREVIEW_SIZE = { width: 1000, height: 700 } as const;
const SELF_ID = "dev.dashi.preview.desktop";
/** What File > Open… lists: every kind Preview names (the viewer checks the bytes). */
const OPENABLE = [...new Set(Object.values(FORMATS).map((format) => format.mime))];
/** A PDF's "100%" is the screen's 96 dpi: a point is 4/3 of a logical pixel. */
const PDF_UNIT = 96 / 72;

type SheetState =
  | { kind: "info" }
  | { kind: "open-with"; handlers: Handler[] | null }
  | { kind: "trash" }
  | { kind: "message"; title: string; message: string }
  | null;

export function PreviewWindow({ viewer, clipboard }: { viewer: Viewer; clipboard?: Clipboard }) {
  const colors = useColors();
  const [board] = useState<Clipboard>(() => clipboard ?? systemClipboard());
  const snap = useSyncExternalStore(viewer.subscribe, viewer.getSnapshot);
  const [mode, setMode] = useState<ZoomMode>(FIT);
  const [pan, setPan] = useState<Pan>({ x: 0, y: 0 });
  const [area, setArea] = useState<Size>({ width: 0, height: 0 });
  const [sheet, setSheet] = useState<SheetState>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [thumbnails, setThumbnails] = useState(true);

  const { picture, pdf } = snap;
  const isPdf = snap.kind === "pdf";
  const unit = isPdf ? PDF_UNIT : 1;
  const fitted = picture ? fitScale(picture, area, isPdf) : 1;
  const scale = scaleOf(mode, fitted);

  // A different file starts fitted and centred; a different page keeps the zoom.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a different file resets the zoom and the pan
  useEffect(() => {
    setMode(FIT);
    setPan({ x: 0, y: 0 });
  }, [snap.path]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a different page or turn re-centres
  useEffect(() => {
    setPan({ x: 0, y: 0 });
  }, [pdf?.page, snap.turns]);

  // A PDF page is drawn again when the zoom would make it soft, once the zoom settles.
  useEffect(() => {
    if (!isPdf || area.width === 0) return undefined;
    const timer = setTimeout(() => void viewer.wantScale(scale), 220);
    return () => clearTimeout(timer);
  }, [isPdf, scale, area.width, viewer]);

  // Keys can arrive several at once (a run of "+"): each must see the zoom the one before it made.
  const live = useRef({ scale, pan, fitted, area, picture });
  live.current = { scale, pan, fitted, area, picture };
  const zoomTo = (next: ZoomMode): void => {
    const was = live.current;
    const to = scaleOf(next, was.fitted);
    const settled = was.picture ? clampPan(panAfterZoom(was.pan, was.scale, to), scaled(was.picture, to), was.area) : { x: 0, y: 0 };
    live.current = { ...was, scale: to, pan: settled };
    setMode(next);
    setPan(settled);
  };
  const stepZoom = (direction: 1 | -1): void => {
    const now = live.current.scale / unit;
    zoomTo({ kind: "scale", scale: (direction > 0 ? zoomIn(now) : zoomOut(now)) * unit });
  };

  const step = (delta: 1 | -1): void => {
    if (pdf) void viewer.goToPage(pdf.page + delta);
    else void viewer.step(delta);
  };
  const canPrevious = pdf ? pdf.page > 1 : snap.folder.previous !== null;
  const canNext = pdf ? pdf.page < pdf.pages : snap.folder.next !== null;

  const message = (title: string, text: string): void => setSheet({ kind: "message", title, message: text });
  const showInfo = (): void => {
    if (picture) setSheet({ kind: "info" });
  };
  // File > Open…: the desktop's file chooser; the chosen file takes this window's place.
  const openFile = (): void => {
    void chooseFile({ title: "Open", filter: { name: "Images and PDFs", types: OPENABLE }, accept: () => true })
      .then((path) => {
        if (path) void viewer.open(path);
      })
      .catch(() => message("The file chooser isn’t available", "Open the file with Preview from Files, or with gio open."));
  };
  const openWithSheet = (): void => {
    if (!snap.path || !snap.format) return;
    setSheet({ kind: "open-with", handlers: null });
    void handlersFor(FORMATS[snap.format].mime, [SELF_ID]).then((handlers) =>
      setSheet((now) => (now?.kind === "open-with" ? { kind: "open-with", handlers } : now)),
    );
  };
  const reveal = (): void => {
    if (!snap.path) return;
    void showInFiles(snap.folder.dir).then(
      (ok) => ok || message("Files could not be opened", "No file manager answered. Install one, or open the folder yourself."),
    );
  };
  const saveCopy = (): void => {
    void viewer
      .saveTurnedCopy()
      .then((result) => ("saved" in result ? message("Copy saved", `“${result.saved}” is next to the original.`) : message("Not saved", result.error)));
  };
  const copyPath = (): void => {
    if (!snap.path) return;
    void board.writeText(snap.path).then((ok) => ok || message("Not copied", "The clipboard could not be written. Is wl-clipboard installed?"));
  };
  const trash = (): void => {
    const { path } = snap;
    if (!path) return;
    const next = snap.folder.next ?? snap.folder.previous;
    setSheet(null);
    void moveToTrash(path).then((error) => {
      if (error !== null) return message("Could not move to the Trash", error);
      if (next && !pdf) void viewer.open(`${snap.folder.dir}/${next}`);
      else viewer.clear();
      return undefined;
    });
  };

  const onKey = (key: KeyInput): void => {
    if (key.kind === "up") step(-1);
    else if (key.kind === "down") step(1);
    else if (key.kind === "backspace" && snap.path) setSheet({ kind: "trash" });
    else if (key.kind === "text") {
      for (const char of key.text) {
        if (char === "+" || char === "=") stepZoom(1);
        else if (char === "-" || char === "_") stepZoom(-1);
        else if (char === "0") zoomTo(FIT);
        else if (char === "1") zoomTo({ kind: "scale", scale: unit });
        else if (char === "r" || char === "R") void viewer.rotate(1);
        else if (char === "l" || char === "L") void viewer.rotate(-1);
        else if (char === "i" || char === "I") showInfo();
        else if (char === "o" || char === "O") openWithSheet();
        else if (char === "f" || char === "F") reveal();
        else if (char === "." || char === ">") step(1);
        else if (char === "," || char === "<") step(-1);
      }
    }
  };

  // The menu bar's menus (src/app-menus/), with the keys they show.
  const canSaveCopy = snap.canSave && (snap.turns !== 0 || snap.exifTurn);
  const { menus, run } = previewMenus({
    hasFile: snap.path !== null,
    hasPicture: picture !== null,
    isPdf,
    canTurn: snap.canTurn,
    canSaveCopy,
    canPrevious,
    canNext,
    canCopy: board.canWrite,
    thumbnails,
    blocked: sheet !== null || menu !== null,
    actions: {
      open: openFile,
      openWith: openWithSheet,
      showInFiles: reveal,
      info: showInfo,
      saveCopy,
      trash: () => {
        if (snap.path) setSheet({ kind: "trash" });
      },
      copyPath,
      actualSize: () => zoomTo({ kind: "scale", scale: unit }),
      zoomIn: () => stepZoom(1),
      zoomOut: () => stepZoom(-1),
      zoomToFit: () => zoomTo(FIT),
      toggleThumbnails: () => setThumbnails((now) => !now),
      rotate: (direction) => void viewer.rotate(direction),
      step,
    },
  });
  useAppMenus(menus, run);

  const moreItems: MenuItem[] = [
    { label: "Open With…", onPress: openWithSheet },
    { label: "Show in Files", onPress: reveal },
    { label: "Save Turned Copy", onPress: saveCopy, disabled: !canSaveCopy },
    { label: "Move to Trash…", onPress: () => setSheet({ kind: "trash" }), disabled: !snap.path },
  ];

  const subtitle = useMemo(() => {
    if (!snap.path) return undefined;
    if (pdf) return `${pdf.pages} ${pdf.pages === 1 ? "page" : "pages"}${pdf.title ? ` · ${pdf.title}` : ""}`;
    const parts: string[] = [];
    if (snap.natural) {
      const size = turned(snap.natural, snap.turns);
      parts.push(`${size.width} × ${size.height}`);
    }
    if (snap.folder.index >= 0 && snap.folder.count > 1) parts.push(`${snap.folder.index + 1} of ${snap.folder.count}`);
    return parts.join(" · ") || undefined;
  }, [snap.path, snap.natural, snap.turns, snap.folder.index, snap.folder.count, pdf]);

  const facts = snap.path ? factsFor(snap.path, snap.format) : null;
  const extraRows: InfoRow[] = pdf
    ? [
        ["Pages", String(pdf.pages)],
        ...(pdf.title ? ([["Title", pdf.title]] as InfoRow[]) : []),
        ...(picture ? ([["Page size", `${Math.round(picture.width)} × ${Math.round(picture.height)} pt`]] as InfoRow[]) : []),
      ]
    : snap.natural
      ? imageRows(snap.natural.width, snap.natural.height, snap.turns)
      : [];
  const overlay =
    sheet?.kind === "info" && facts ? (
      <InfoSheet rows={infoRows(facts, extraRows)} onClose={() => setSheet(null)} />
    ) : sheet?.kind === "open-with" ? (
      <OpenWithSheet
        handlers={sheet.handlers ?? []}
        loading={sheet.handlers === null}
        onClose={() => setSheet(null)}
        onPick={(handler) => {
          setSheet(null);
          if (snap.path)
            void openWith(handler, snap.path).then((ok) => ok || message(`${handler.name} did not open it`, "The app could not be started with this file."));
        }}
      />
    ) : sheet?.kind === "trash" ? (
      <ConfirmSheet
        testID="trash"
        title={`Move “${snap.name}” to the Trash?`}
        message="You can put it back from the Trash."
        confirmLabel="Move to Trash"
        glyph={glyphs.TRASH}
        danger
        onCancel={() => setSheet(null)}
        onConfirm={trash}
      />
    ) : sheet?.kind === "message" ? (
      <MessageSheet title={sheet.title} message={sheet.message} onClose={() => setSheet(null)} />
    ) : menu ? (
      <PopupMenu testID="more-menu" x={menu.x} y={menu.y} items={moreItems} onClose={() => setMenu(null)} />
    ) : undefined;

  const toolbar = (
    <PreviewToolbar
      canPrevious={canPrevious}
      canNext={canNext}
      onPrevious={() => step(-1)}
      onNext={() => step(1)}
      position={pdf ? `${pdf.page} / ${pdf.pages}` : null}
      zoomLabel={picture ? percent(scale / unit) : ""}
      onZoomOut={() => stepZoom(-1)}
      onZoomIn={() => stepZoom(1)}
      onFit={() => zoomTo(FIT)}
      onActual={() => zoomTo({ kind: "scale", scale: unit })}
      canTurn={snap.canTurn}
      onTurnLeft={() => void viewer.rotate(-1)}
      onTurnRight={() => void viewer.rotate(1)}
      onInfo={showInfo}
      onMore={(bounds) => setMenu({ x: Math.max((bounds?.x ?? 0) - 120, 8), y: (bounds?.y ?? 0) + (bounds?.height ?? 28) + 4 })}
      hasPicture={picture !== null}
    />
  );

  const content = picture ? (
    <Canvas picture={picture} scale={scale} pan={pan} onPan={setPan} onArea={setArea} area={area} />
  ) : snap.phase === "error" ? (
    <EmptyState testID="error" title="This file can’t be shown" message={snap.error ?? undefined} glyph={isPdf ? glyphs.DOCUMENT : glyphs.PICTURE} />
  ) : snap.phase === "loading" ? (
    <EmptyState testID="loading" title="Opening…" />
  ) : (
    <EmptyState
      testID="empty"
      title="No file open"
      message="Open an image or a PDF here, or with Preview from Files."
      glyph={glyphs.PICTURE}
      action={<Button testID="open" label="Open…" onPress={openFile} />}
    />
  );

  const footer = snap.note ? (
    <View testID="note" style={{ paddingHorizontal: 14, paddingVertical: 6, borderTopWidth: 1, borderColor: colors.separator }}>
      <Text style={{ fontSize: 11, color: colors.textMuted }}>{snap.note}</Text>
    </View>
  ) : undefined;

  return (
    <AppWindow
      title={snap.name || "Preview"}
      {...(subtitle !== undefined ? { subtitle } : {})}
      toolbar={toolbar}
      sidebar={pdf && thumbnails ? <Thumbnails pdf={pdf} pageSize={viewer.firstPageSize} onPage={(page) => void viewer.goToPage(page)} /> : undefined}
      sidebarWidth={190}
      footer={footer}
      overlay={overlay}
    >
      {sheet === null && menu === null && <KeySink testID="keys" onKey={onKey} />}
      {content}
    </AppWindow>
  );
}
