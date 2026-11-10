/**
 * The sidebar: the page strip. A PDF's pages, or the pictures in the open
 * one's folder (once there is more than one). Picking a row goes to that page
 * or picture; the rows on screen ask for their thumbnails.
 */

import { useMemo } from "react";
import type { DocumentView } from "./document.ts";
import type { Snapshot } from "./snapshot.ts";
import { Strip, type StripItem, UNKNOWN_SHAPE } from "./strip.tsx";
import type { Viewer } from "./viewer.ts";

/** Whether the window has a strip to show at all: a PDF, or a picture with others in its folder. */
export function hasStrip(snap: Snapshot): boolean {
  return snap.pdf !== null || (snap.kind === "image" && snap.folder.count > 1);
}

export function PreviewSidebar({ snap, doc, viewer, width }: { snap: Snapshot; doc: DocumentView; viewer: Viewer; width: number }) {
  const pdf = snap.pdf;
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
  if (pdf) {
    return (
      <Strip
        testID="strip"
        items={pdfItems}
        current={doc.page - 1}
        onPick={(index) => doc.goToPage(index + 1)}
        onVisible={(rows) => doc.setStripPages(rows.map((row) => row + 1))}
        width={width}
      />
    );
  }
  return (
    <Strip
      testID="strip"
      items={folderItems}
      current={snap.folder.index}
      onPick={(index) => {
        const name = snap.folder.files[index];
        if (name) void viewer.openSibling(name);
      }}
      onVisible={(rows) => viewer.wantFolderThumbs(rows.map((row) => snap.folder.files[row]).filter((name): name is string => name !== undefined))}
      width={width}
    />
  );
}
