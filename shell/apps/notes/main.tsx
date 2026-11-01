/**
 * Notes (dev.dashi.notes): `bun apps/notes/main.tsx [host]`. The notes are
 * Markdown files under ~/Documents/Notes (store.ts); this is the window on
 * them. `DASHI_NOTES_DIR` points it somewhere else.
 */

import { runApp } from "../kit/index.ts";
import { NotesModel } from "./model.ts";
import { defaultRoot, NotesStore } from "./store.ts";
import { NOTES_SIZE, NotesWindow } from "./view.tsx";
import { watchNotes } from "./watch.ts";

const store = new NotesStore(defaultRoot());
store.purgeExpired();
const model = new NotesModel(store);

// The view scrolls the editor through the app once the window exists.
const handle: { scroll: (testID: string, dy: number) => void } = { scroll: () => {} };

const app = runApp(
  { id: "dev.dashi.notes", title: "Notes", size: NOTES_SIZE },
  <NotesWindow model={model} scroll={(testID, dy) => handle.scroll(testID, dy)} />,
);
handle.scroll = (testID, dy) => {
  const id = app.root.nodeId(testID);
  if (id) app.host.simulate({ kind: "scroll", id, dy });
};

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
