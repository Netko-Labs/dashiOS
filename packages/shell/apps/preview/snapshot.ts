/**
 * What Preview's window draws from: the Viewer's snapshot (viewer.ts), a
 * new object whenever anything in it changes, and the closed state a new
 * open starts from.
 */

import type { Format, Kind } from "../../src/shared/files/kinds.ts";
import type { Stamp } from "./cache.ts";
import type { Size } from "./dimensions.ts";
import type { FileFacts } from "./info.ts";
import type { Recent } from "./memory.ts";
import type { PdfPagesState } from "./pdf-doc.ts";
import type { Neighbours } from "./siblings.ts";

export interface Picture {
  /** The file Metal draws. */
  source: string;
  /** Its size in pixels. */
  width: number;
  height: number;
}

export interface PdfState extends PdfPagesState {
  pages: number;
  title: string | null;
  /** Each page's size in points as it is shown: its own rotation and Preview's applied. */
  sizes: Size[];
}

export interface Snapshot {
  phase: "empty" | "loading" | "ready" | "error";
  error: string | null;
  path: string | null;
  name: string;
  kind: Kind | null;
  format: Format | null;
  /** What the file is, for Open With: its format's type, or what Preview could tell of a file it can't show (kinds.ts `otherMime`). */
  mime: string | null;
  /** An image's picture (a PDF's pages are in `pdf`). */
  picture: Picture | null;
  /** Pixels of the file as stored, after the EXIF turn (what the info sheet says). */
  natural: Size | null;
  /** Quarter turns clockwise the file is shown at (remembered for it). */
  turns: number;
  /** It can be rotated (ImageMagick is there and the format allows it). */
  canTurn: boolean;
  folder: Neighbours & { dir: string; files: readonly string[] };
  /** Small copies of the folder's pictures, by name, for the page strip. */
  folderThumbs: ReadonlyMap<string, string>;
  /** Their shapes (height over width), by name, once their small copies are made. */
  folderShapes: ReadonlyMap<string, number>;
  pdf: PdfState | null;
  /** Something the person asked for is being done (opening, rotating). */
  busy: boolean;
  /** How the picture is shown, when it isn't as the file is ("Shown smaller…"), for Info. */
  note: string | null;
  facts: FileFacts | null;
  recents: readonly Recent[];
  tools: { magick: boolean; poppler: boolean; qpdf: boolean };
  stamp: Stamp | null;
  rev: number;
}

export const EMPTY_FOLDER: Snapshot["folder"] = { dir: "", files: [], index: -1, count: 0, previous: null, next: null };

/** Nothing open. */
export const CLOSED = {
  phase: "empty",
  error: null,
  path: null,
  name: "",
  kind: null,
  format: null,
  mime: null,
  picture: null,
  natural: null,
  turns: 0,
  canTurn: false,
  folder: EMPTY_FOLDER,
  folderThumbs: new Map(),
  folderShapes: new Map(),
  pdf: null,
  busy: false,
  note: null,
  facts: null,
  stamp: null,
} as const satisfies Partial<Snapshot>;
