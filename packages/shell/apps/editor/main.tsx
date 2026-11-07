/**
 * Text Editor (dev.dashi.editor): `bun apps/editor/main.tsx [--host <path>] [file…]`.
 * Plain text in one window per document (model.ts is the document,
 * view.tsx the window). The first file opens here and each other one in a
 * window of its own, with the changes kept for it if an earlier window
 * couldn't write them; without a file, every draft comes back (recovery.ts),
 * else an Untitled document.
 *
 * Nothing is ever lost and nothing asks: a moment after typing stops (and as
 * the window goes, however it goes) a document with a file is written to it,
 * keeping earlier versions (versions.ts), and an Untitled one is kept as a
 * draft. Every few seconds the window looks at its file, for changes made
 * elsewhere, and at the View settings, which another window may have changed.
 */

import { resolve } from "node:path";
import { METAL_HOST } from "../../src/apps.ts";
import { runApp } from "../kit/index.ts";
import { parseArgs } from "./args.ts";
import { EditorModel } from "./model.ts";
import { moveOldRecovery, RecoveryKeeper, recoveryFiles, recoveryFor, takeRecovery } from "./recovery.ts";
import { VersionStore } from "./versions.ts";
import { EDITOR_SIZE, EditorWindow } from "./view.tsx";
import { type Launch, openWindow, windowCommand } from "./windows.ts";

const args = parseArgs(Bun.argv.slice(2));
const launch: Launch = { bun: process.execPath, main: import.meta.path, host: args.host ?? process.env.DASHI_METAL_HOST ?? METAL_HOST };
const cwd = process.cwd();
const model = new EditorModel({ versions: new VersionStore() });
const files = args.files.map((file) => resolve(cwd, file));
// Written to its file first; what that leaves unsaved (a draft, a file that can't be written) is kept.
const keeper = new RecoveryKeeper(() => {
  model.autosave();
  return model.recovery();
});
moveOldRecovery();

// The window drives itself through the app once it exists: Cut, Copy, Paste and Select All, scrolling, and focus.
const handle = {
  press: (_keystroke: string): void => {},
  scroll: (_dy: number, _fromTop: boolean): void => {},
  focusText: (): void => {},
  setTitle: (_title: string): void => {},
};
/** Stable across renders, so the window retitles only when its name changes. */
const setTitle = (title: string): void => handle.setTitle(title);
let discard = false;
/** How often the window looks at its file and the View settings. */
const DISK_CHECK_MS = 2000;

const app = runApp(
  // Its Edit rows already act on whichever field has the keyboard, and its Undo is the document's.
  { id: "dev.dashi.editor", title: "Text Editor", size: EDITOR_SIZE, host: launch.host, textChordsToFields: false },
  <EditorWindow
    model={model}
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
// A simulated click on the input focuses it and leaves its caret and selection where they were (a real click places the caret).
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
// What was taken is this window's to keep now; then every change is saved (or kept) a moment after typing stops.
keeper.flush();
let seen = model.getSnapshot();
model.subscribe(() => {
  const now = model.getSnapshot();
  if (now.text !== seen.text || now.saved !== seen.saved || now.path !== seen.path) keeper.changed();
  seen = now;
});
setInterval(() => {
  model.checkDisk();
  model.reloadPrefs();
}, DISK_CHECK_MS);

// However the window goes (File › Close, its close button, ❖Q, logging out, a signal), what isn't written is
// written or kept; Delete Draft drops it.
process.on("exit", () => {
  if (discard) keeper.discard();
  else keeper.flush();
});
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, () => process.exit(0));
