/**
 * The window's main body, one of: a PDF's scrolling pages, a picture, the
 * error that says why a file can't be shown, the loading line, or the empty
 * window's Open and recent files. Which one is up follows the viewer's state.
 */

import { Loading } from "@dashi/ui";
import { Canvas } from "./canvas.tsx";
import type { DocumentView } from "./document.ts";
import type { PictureView } from "./picture-view.ts";
import type { Snapshot } from "./snapshot.ts";
import { EmptyView, ErrorView } from "./states.tsx";
import { DocumentSurface } from "./surface.tsx";

export function PreviewContent({
  snap,
  doc,
  pictureView,
  ground,
  openWithSheet,
  open,
  openRecent,
}: {
  snap: Snapshot;
  doc: DocumentView;
  pictureView: PictureView;
  /** The surface's ground, behind the pages and the picture. */
  ground: string;
  openWithSheet: () => void;
  open: () => void;
  openRecent: (path: string) => void;
}) {
  const { pdf, picture } = snap;
  if (pdf && snap.phase === "ready") return <DocumentSurface pdf={pdf} doc={doc} turns={snap.turns} ground={ground} />;
  if (picture) {
    return (
      <Canvas
        picture={picture}
        scale={pictureView.scale}
        pan={pictureView.pan}
        onPan={pictureView.setPan}
        onArea={pictureView.setArea}
        area={pictureView.area}
        ground={ground}
      />
    );
  }
  if (snap.phase === "error") {
    return <ErrorView name={snap.name} message={snap.error ?? ""} onOpenWith={snap.mime ? openWithSheet : null} onOpen={open} />;
  }
  if (snap.phase === "loading") return <Loading testID="loading" label={`Opening “${snap.name}”…`} />;
  return <EmptyView recents={snap.recents} onOpen={open} onRecent={openRecent} />;
}
