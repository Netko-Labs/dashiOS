/**
 * The zoom, in the same words for a picture and a PDF: in, out, to fit, to
 * the actual size, to the width. The label is the zoom the toolbar shows
 * beside the buttons. Each zoom goes to the view that is on screen.
 */

import { type DocumentView, PDF_UNIT } from "./document.ts";
import type { PictureView } from "./picture-view.ts";
import type { PdfState, Picture } from "./snapshot.ts";
import { FIT, percent } from "./zoom.ts";

export interface ZoomControls {
  in(): void;
  out(): void;
  fit(): void;
  actual(): void;
  width(): void;
}

export interface ZoomView {
  zoom: ZoomControls;
  /** "150%", or "" when nothing is zoomed. */
  label: string;
}

export function useZoom(pdf: PdfState | null, picture: Picture | null, doc: DocumentView, pictureView: PictureView): ZoomView {
  return {
    zoom: {
      in: () => (pdf ? doc.stepZoom(1) : pictureView.stepZoom(1)),
      out: () => (pdf ? doc.stepZoom(-1) : pictureView.stepZoom(-1)),
      fit: () => (pdf ? doc.zoomTo({ kind: "fit" }) : pictureView.zoomTo(FIT)),
      actual: () => (pdf ? doc.zoomTo({ kind: "scale", scale: PDF_UNIT }) : pictureView.zoomTo({ kind: "scale", scale: 1 })),
      width: () => doc.zoomTo({ kind: "width" }),
    },
    label: pdf ? percent(doc.scale / PDF_UNIT) : picture ? percent(pictureView.scale) : "",
  };
}
