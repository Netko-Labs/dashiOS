/**
 * Preview's window, as layout: the chrome row (toolbar.tsx), the page strip
 * in the sidebar (sidebar.tsx), the picture or the PDF's scrolling pages
 * (content.tsx), and the sheets and the "…" menu. What the window does lives
 * in its hooks: the window's own state (use-chrome.ts), the file's view
 * (picture-view.ts, document.ts), the zoom (use-zoom.ts), the commands
 * (use-actions.ts), the keys (use-keys.ts) and the toolbar's plan
 * (use-toolbar.ts). The slow state (files, tools) is the Viewer's (viewer.ts).
 * A file dropped anywhere on the window opens in it (drop.ts); with no file
 * open, the window offers only that, Open… and the recent files.
 */

import { AppWindow, useColors, useSurface } from "@dashi/ui";
import { View } from "@mirinjs/metal";
import { useState, useSyncExternalStore } from "react";
import { type Clipboard, systemClipboard, useAppMenus } from "../../../kit/index.ts";
import { useDocument } from "../document.ts";
import { useDropArea } from "../drop.ts";
import { useActions } from "../hooks/use-actions.ts";
import { useChrome } from "../hooks/use-chrome.ts";
import { useKeys } from "../hooks/use-keys.ts";
import { useToolbar } from "../hooks/use-toolbar.ts";
import { useZoom } from "../hooks/use-zoom.ts";
import { keyAction } from "../keys.ts";
import { previewMenus } from "../menus.ts";
import { usePictureView } from "../picture-view.ts";
import type { Viewer } from "../viewer.ts";
import { PreviewContent } from "./content.tsx";
import { windowOverlay } from "./overlay.tsx";
import { hasStrip, PreviewSidebar } from "./sidebar.tsx";
import { ToolbarRow } from "./toolbar.tsx";

export const PREVIEW_SIZE = { width: 1000, height: 700 } as const;
/** The least the window gets: a picture, the name, Previous and Next, and "…" still fit (fold.ts). */
export const PREVIEW_MIN_SIZE = { width: 360, height: 280 } as const;

export function PreviewWindow({ viewer, clipboard, cacheDir }: { viewer: Viewer; clipboard?: Clipboard; cacheDir?: string }) {
  const colors = useColors();
  const surface = useSurface();
  const [board] = useState<Clipboard>(() => clipboard ?? systemClipboard());
  const snap = useSyncExternalStore(viewer.subscribe, viewer.getSnapshot);
  const chrome = useChrome();
  const isPdf = snap.kind === "pdf";
  const pictureView = usePictureView(snap.picture, snap.path, snap.turns);
  const doc = useDocument(viewer, snap.pdf, snap.turns, snap.path);
  const hasPicture = snap.picture !== null || (snap.pdf !== null && snap.phase === "ready");
  const { zoom, label: zoomLabel } = useZoom(snap.pdf, snap.picture, doc, pictureView);
  const commands = useActions({ viewer, board, cacheDir, snap, doc, zoom, hasPicture, chrome });
  const onKey = useKeys({ doc, step: commands.step, trash: commands.actions.trash });
  const toolbar = useToolbar({ snap, page: doc.page, zoomLabel, zoom, commands, hasPicture, isPdf, chrome });

  // The menu bar's menus (src/app-menus/), with the keys they show.
  const { menus, run } = previewMenus({
    hasFile: snap.path !== null,
    hasPicture,
    isPdf,
    canTurn: snap.canTurn,
    canPrevious: commands.canPrevious,
    canNext: commands.canNext,
    canCopy: board.canWrite,
    hasSelection: doc.range !== null,
    canExport: commands.formats.length > 0,
    canPrint: commands.canPrint,
    sidebar: chrome.sidebar,
    recents: snap.recents.map((recent) => recent.path),
    blocked: chrome.sheet !== null || chrome.menu !== null,
    actions: commands.actions,
  });
  useAppMenus(menus, run);

  const overlay = windowOverlay({ chrome, snap, page: doc.page, hooks: commands.hooks, moreItems: toolbar.moreItems });

  const drop = useDropArea((path) => {
    chrome.setSheet(null);
    chrome.setMenu(null);
    void viewer.open(path);
  });
  const sidebarShown = hasStrip(snap) && chrome.sidebar;

  return (
    <AppWindow
      title={toolbar.title}
      center={<ToolbarRow title={toolbar.title} plan={toolbar.plan} busy={toolbar.busy} props={toolbar.props} shown={toolbar.shown} onRoom={toolbar.setRoom} />}
      // Present, if empty, so the row is there with the compositor's own title bar too.
      toolbar={null}
      sidebar={sidebarShown ? <PreviewSidebar snap={snap} doc={doc} viewer={viewer} width={chrome.sidebarWidth} /> : undefined}
      sidebarWidth={chrome.sidebarWidth}
      overlay={overlay}
    >
      {chrome.sheet === null && chrome.menu === null && (
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
        onLayout={(bounds) => chrome.setWindowWidth(Math.round(bounds.width + (sidebarShown ? chrome.sidebarWidth : 0)))}
        style={{ flex: 1, flexDirection: "column", minHeight: 0, minWidth: 0, position: "relative", backgroundColor: surface.canvas }}
      >
        <PreviewContent
          snap={snap}
          doc={doc}
          pictureView={pictureView}
          ground={surface.canvas}
          openWithSheet={commands.openWithSheet}
          open={commands.actions.open}
          openRecent={commands.actions.openRecent}
        />
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
