/**
 * Text Editor (dev.dashi.editor): `bun apps/editor/main.tsx [--host <path>] [file…]`.
 * Plain text in one window per document (model.ts is the document,
 * view.tsx the window). The first file opens here and each other one in a
 * window of its own; without a file, changes kept when an earlier window
 * closed come back (recovery.ts), else an Untitled document.
 */

import { resolve } from "node:path";
import { METAL_HOST } from "../../src/apps.ts";
import { runApp, systemClipboard } from "../kit/index.ts";
import { parseArgs } from "./args.ts";
import { EditorModel } from "./model.ts";
import { keepRecovery, recoveryFiles, takeRecovery } from "./recovery.ts";
import { EDITOR_SIZE, EditorWindow } from "./view.tsx";
import { type Launch, openWindow, windowCommand } from "./windows.ts";

const args = parseArgs(Bun.argv.slice(2));
const launch: Launch = { bun: process.execPath, main: import.meta.path, host: args.host ?? process.env.DASHI_METAL_HOST ?? METAL_HOST };
const cwd = process.cwd();
const model = new EditorModel();
const files = args.files.map((file) => resolve(cwd, file));

// The window drives itself through the app once it exists: Paste and Select All, and scrolling.
const handle: { press: (keystroke: string) => void; scroll: (dy: number, fromTop: boolean) => void } = { press: () => {}, scroll: () => {} };
let discard = false;

const app = runApp(
  { id: "dev.dashi.editor", title: "Text Editor", size: EDITOR_SIZE, host: launch.host },
  <EditorWindow
    model={model}
    clipboard={systemClipboard()}
    quit={(drop) => {
      discard = drop;
      app.quit();
    }}
    newWindow={(paths) => openWindow(windowCommand(launch, paths), cwd)}
    press={(keystroke) => handle.press(keystroke)}
    scroll={(dy, fromTop) => handle.scroll(dy, fromTop)}
  />,
);
handle.press = (keystroke) => app.host.simulate({ kind: "key", keystroke });
handle.scroll = (dy, fromTop) => {
  const id = app.root.nodeId("editor");
  if (!id) return;
  if (fromTop) app.host.simulate({ kind: "scroll", id, dy: -100_000_000 });
  app.host.simulate({ kind: "scroll", id, dy });
};

const [first, ...rest] = files;
if (first !== undefined) {
  model.open(first);
  for (const file of rest) openWindow(windowCommand(launch, [file]), cwd);
} else {
  // A window opened for one kept file takes that one; a plain one takes them all, one per window.
  const kept = args.recover !== null ? [args.recover] : recoveryFiles();
  const [mine, ...others] = kept;
  const recovery = mine !== undefined ? takeRecovery(mine) : null;
  if (recovery) model.recover(recovery);
  if (args.recover === null) for (const name of others) openWindow(windowCommand(launch, [], name), cwd);
}

// What isn't saved is kept when the window goes without asking (its close button, ❖W, ❖Q, logging out).
process.on("exit", () => {
  const recovery = discard ? null : model.recovery();
  if (recovery) keepRecovery(recovery);
});
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, () => process.exit(0));
