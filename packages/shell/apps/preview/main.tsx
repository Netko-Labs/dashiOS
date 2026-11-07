/**
 * Preview (dev.dashi.preview): `bun apps/preview/main.tsx [--host <path>] [file]`.
 * Images and PDFs; the work is viewer.ts, the window is view.tsx. Each
 * file opens in its own process, so opening a second file from Files or
 * `gio open` gives a second window, unless a Preview window is empty: that
 * one takes the file and comes forward, and this start leaves (instance.ts).
 */

import { resolve } from "node:path";
import { METAL_HOST } from "../../src/apps.ts";
import { menusClient, runApp } from "../kit/index.ts";
import { parseArgs } from "./args.ts";
import { cacheRoot, pruneCache } from "./cache.ts";
import { handToEmpty, listenWhileEmpty } from "./instance.ts";
import { PREVIEW_SIZE, PreviewWindow } from "./view.tsx";
import { Viewer } from "./viewer.ts";

const args = parseArgs(Bun.argv.slice(2));
const first = args.files[0];
// An empty window waiting: it shows the file, and no second window comes up.
if (first && (await handToEmpty(resolve(first)))) process.exit(0);

const viewer = new Viewer();
runApp(
  { id: "dev.dashi.preview", title: "Preview", size: PREVIEW_SIZE, host: args.host ?? process.env.DASHI_METAL_HOST ?? METAL_HOST },
  <PreviewWindow viewer={viewer} />,
);

if (first) void viewer.open(first);

// While nothing is open, the next file opened anywhere comes here. The
// answer goes out first and the file opens on the next tick: opening stops
// the listener, which would otherwise close the connection before the
// "taken" reply, and the other start would open a window of its own too.
// One file is claimed at once, so two quick offers can't both land here.
let claimed = false;
const take = (path: string): boolean => {
  if (claimed || viewer.getSnapshot().phase !== "empty") return false;
  claimed = true;
  setTimeout(() => {
    void viewer.open(path);
    menusClient().front();
  }, 0);
  return true;
};
let stopListening: (() => void) | null = null;
const follow = (): void => {
  const empty = viewer.getSnapshot().phase === "empty";
  if (empty && !stopListening) {
    claimed = false;
    stopListening = listenWhileEmpty(take);
  }
  else if (!empty && stopListening) {
    stopListening();
    stopListening = null;
  }
};
viewer.subscribe(follow);
follow();
process.on("exit", () => stopListening?.());

// Keep the cache inside its bounds; after the window is up, so it never delays opening.
setTimeout(() => pruneCache(cacheRoot()), 3000);
