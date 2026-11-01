/**
 * Preview (dev.dashi.preview): `bun apps/preview/main.tsx [--host <path>] [file]`.
 * Images and PDFs; the work is viewer.ts, the window is view.tsx. Each
 * file opens in its own process, so opening a second file from Files or
 * `gio open` gives a second window.
 */

import { METAL_HOST } from "../../src/apps.ts";
import { runApp } from "../kit/index.ts";
import { parseArgs } from "./args.ts";
import { cacheRoot, pruneCache } from "./cache.ts";
import { PREVIEW_SIZE, PreviewWindow } from "./view.tsx";
import { Viewer } from "./viewer.ts";

const args = parseArgs(Bun.argv.slice(2));
const viewer = new Viewer();
runApp({ id: "dev.dashi.preview", title: "Preview", size: PREVIEW_SIZE, host: args.host ?? process.env.DASHI_METAL_HOST ?? METAL_HOST }, <PreviewWindow viewer={viewer} />);

const first = args.files[0];
if (first) void viewer.open(first);
// Keep the cache inside its bounds; after the window is up, so it never delays opening.
setTimeout(() => pruneCache(cacheRoot()), 3000);
