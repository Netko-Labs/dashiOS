/** Files: opening an image or a PDF in Preview. */

import { isAbsolute, normalize } from "node:path";
import type { ToolDef } from "../define.ts";
import { custom, tool } from "./args.ts";

/** Longest path accepted (Linux's PATH_MAX). */
const PATH_MAX = 4096;

/** `path` as the tool takes it: absolute, one line, no NUL; null otherwise. Redundant `.` and `..` are resolved. */
export function previewPath(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > PATH_MAX) return null;
  if (!isAbsolute(value) || /[\0-\x1f\x7f]/.test(value)) return null;
  return normalize(value);
}

export const previewTools: readonly ToolDef[] = [
  tool({
    name: "open_in_preview",
    title: "Open a file in Preview",
    description:
      "Open an image (PNG, JPEG, WebP, GIF, BMP, SVG, TIFF) or a PDF in Preview, Dashi's viewer, by its absolute path, in a new window that the person sees, and return that window (waiting up to 10 seconds). " +
      "It only shows the file on screen: it cannot read, change, or send it. Use screenshot (with the screen permission) to look at what Preview shows.",
    scope: "act",
    readOnly: false,
    destructive: false,
    args: {
      path: custom(
        { type: "string", description: "An absolute path, like /home/me/Pictures/photo.jpg." },
        previewPath,
        "`path` is required: an absolute path to an image or a PDF, on one line.",
      ),
    },
    build: ({ path }) => ({ name: "open_in_preview", path }),
  }),
];
