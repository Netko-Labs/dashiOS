/**
 * Text Editor (dev.dashi.editor): `bun apps/editor/main.tsx [--host <path>] [file…]`.
 * Plain text in one window per document (model.ts is the document,
 * view.tsx the window). The first file opens here and each other one in a
 * window of its own, with the changes kept for it if an earlier window
 * closed or crashed before saving them; without a file, all kept changes
 * come back (recovery.ts), else an Untitled document. What isn't saved is
 * kept as it is typed, so no way of closing loses it.
 */

import { resolve } from "node:path";
import { METAL_HOST } from "../../src/apps.ts";
import { runApp, systemClipboard } from "../kit/index.ts";
import { parseArgs } from "./args.ts";
import { EditorModel } from "./model.ts";
import { RecoveryKeeper, recoveryFiles, recoveryFor, takeRecovery } from "./recovery.ts";
import { EDITOR_SIZE, EditorWindow } from "./view.tsx";
import { type Launch, openWindow, windowCommand } from "./windows.ts";

const args = parseArgs(Bun.argv.slice(2));
const launch: Launch = { bun: process.execPath, main: import.meta.path, host: args.host ?? process.env.DASHI_METAL_HOST ?? METAL_HOST };
const cwd = process.cwd();
const model = new EditorModel();
const files = args.files.map((file) => resolve(cwd, file));
const keeper = new RecoveryKeeper(() => model.recovery());

// The window drives itself through the app once it exists: Paste and Select All, scrolling, and focus.
const handle = {
  press: (_keystroke: string): void => {},
  scroll: (_dy: number, _fromTop: boolean): void => {},
  focusText: (): void => {},
  setTitle: (_title: string): void => {},
};
/** Stable across renders, so the window retitles only when its name changes. */
const setTitle = (title: string): void => handle.setTitle(title);
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
    focusText={() => handle.focusText()}
    setTitle={setTitle}
  />,
);
handle.press = (keystroke) => app.host.simulate({ kind: "key", keystroke });
handle.scroll = (dy, fromTop) => {
  const id = app.root.nodeId("editor");
  if (!id) return;
  if (fromTop) app.host.simulate({ kind: "scroll", id, dy: -100_000_000 });
  app.host.simulate({ kind: "scroll", id, dy });
};
// A click on the input focuses it and leaves its caret where it was (Metal places no caret on a click yet).
handle.focusText = () => {
  const id = app.root.nodeId("text");
  if (id) app.host.simulate({ kind: "click", id });
};
handle.setTitle = (title) => app.host.setTitle(title);

const [first, ...rest] = files;
if (first !== undefined) {
  // Changes to this file that an earlier window kept come back instead of the file as it is.
  const kept = recoveryFor(first);
  const recovery = kept !== null ? takeRecovery(kept) : null;
  if (recovery) model.recover(recovery);
  else model.open(first);
  for (const file of rest) openWindow(windowCommand(launch, [file]), cwd);
} else {
  // A window opened for one kept file takes that one; a plain one takes them all, one per window.
  const kept = args.recover !== null ? [args.recover] : recoveryFiles();
  const [mine, ...others] = kept;
  const recovery = mine !== undefined ? takeRecovery(mine) : null;
  if (recovery) model.recover(recovery);
  if (args.recover === null) for (const name of others) openWindow(windowCommand(launch, [], name), cwd);
}
// What was taken is this window's to keep now; then every change is kept a moment after typing stops.
keeper.flush();
model.subscribe(() => keeper.changed());

// The window going without asking (its close button, ❖Q, logging out) keeps what isn't saved; Don't Save drops it.
process.on("exit", () => {
  if (discard) keeper.discard();
  else keeper.flush();
});
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, () => process.exit(0));
