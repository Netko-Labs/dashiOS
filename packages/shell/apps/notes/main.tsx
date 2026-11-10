/**
 * Notes (dev.dashi.notes): `bun apps/notes/main.tsx [host]`. The notes are
 * Markdown files under ~/Documents/Notes (store.ts); this is the window on
 * them. `DASHI_NOTES_DIR` points it somewhere else.
 */

import { defaultRoot, NotesStore } from "../../src/shared/notes/store.ts";
import { runApp } from "../kit/index.ts";
import { NOTES_MIN_SIZE } from "./layout.ts";
import { NotesModel } from "./model.ts";
import { NOTES_SIZE, type NotesHost, NotesWindow } from "./view.tsx";
import { watchNotes } from "./watch.ts";

const store = new NotesStore(defaultRoot());
store.purgeExpired();
const model = new NotesModel(store);

/** A link from a note opens in its app when it is a web or mail address; nothing else is opened. */
function openLink(url: string): void {
  if (!/^(?:https?:\/\/|mailto:)\S+$/i.test(url)) return;
  const opener = Bun.which("gio") ? ["gio", "open", url] : ["xdg-open", url];
  try {
    Bun.spawn(opener, { stdout: "ignore", stderr: "ignore" });
  } catch {
    // Nothing to open it with: the link stays text.
  }
}

// The view reaches the window through the app once it exists.
const host: NotesHost = { scroll: () => {}, press: () => {}, openLink };

const app = runApp(
  // Edit's rows act on the field with the keyboard themselves (Cut, Copy, Paste, Select All as its keys), and its Undo is the note's.
  { id: "dev.dashi.notes", title: "Notes", size: NOTES_SIZE, minSize: NOTES_MIN_SIZE, textChordsToFields: false },
  <NotesWindow model={model} host={host} />,
);
host.scroll = (testID, dy) => {
  const id = app.root.nodeId(testID);
  if (id) app.host.simulate({ kind: "scroll", id, dy });
};
host.press = (keystroke) => app.host.simulate({ kind: "key", keystroke });

const stopWatching = watchNotes(store.root, () => model.reload());
const purge = setInterval(() => {
  if (store.purgeExpired() > 0) model.reload();
}, 3_600_000);
purge.unref();

// Whatever is typed and not yet saved is written before the process goes (the window closing ends it at once).
const finish = (): void => {
  stopWatching();
  model.dispose();
};
process.on("exit", finish);
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, () => process.exit(0));
