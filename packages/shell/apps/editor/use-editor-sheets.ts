/**
 * The sheets over the editor, one at a time (sheets.tsx), and what closes
 * them: Save, Open and Save As through Files' chooser, the question when the
 * file changed on disk, and closing the window.
 *
 * The text keeps its input (and its caret) through all of these: it is
 * focused, never mounted again.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { type MutableRefObject, useEffect, useMemo, useRef, useState } from "react";
import { chooserRequest } from "../files/chooser/index.ts";
import { useCloseRequest, useCloseWithdrawn } from "../kit/index.ts";
import type { EditorModel, EditorState } from "./model.ts";
import { resolveInput, suggestedSavePath } from "./names.ts";
import type { SheetState } from "./sheets.tsx";

/** The home folder as the session gives it ($HOME), as Files' chooser takes it. */
const homeFolder = (): string => process.env.HOME || homedir();

export interface EditorSheets {
  sheet: SheetState | null;
  setSheet: (sheet: SheetState | null) => void;
  /** The chooser's request while an Open or Save As sheet is up. */
  chooser: ReturnType<typeof chooserRequest> | null;
  /** The window is closing, held by a conflict. */
  closing: MutableRefObject<boolean>;
  closeSheet: () => void;
  save: () => void;
  requestClose: () => void;
  afterConflict: () => void;
  /** Opens `path` here while this window is an untouched Untitled, else in a window of its own; a message when it couldn't. */
  openPath: (path: string) => string | null;
  chooseOpen: (path: string) => void;
  chooseSaveAs: (path: string) => void;
}

export function useEditorSheets({
  model,
  state,
  name,
  quit,
  newWindow,
  focusText,
}: {
  model: EditorModel;
  state: EditorState;
  name: string;
  quit: (discard: boolean) => void;
  newWindow: (files: readonly string[]) => void;
  focusText: () => void;
}): EditorSheets {
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const closing = useRef(false);
  const base = state.path !== null ? dirname(state.path) : homeFolder();

  // A change on disk while there were changes here asks which text wins.
  useEffect(() => {
    if (state.conflict && !sheet) setSheet({ kind: "conflict", after: null });
  }, [state.conflict, sheet]);

  const closeSheet = (): void => {
    setSheet(null);
    focusText();
  };
  const save = (): void => {
    const result = model.save();
    if (result === "needs-path") setSheet({ kind: "save-as" });
    else if (result === "conflict") setSheet({ kind: "conflict", after: null });
    else closeSheet();
  };
  // File › Close, ❖W, the close control, ❖Q, the Dock's Quit, logging out: the document saves (or stays a
  // draft) as the process ends (main.tsx); only a conflict holds the window to ask.
  const requestClose = (): void => {
    if (model.autosave() === "conflict") {
      closing.current = true;
      setSheet({ kind: "conflict", after: "close" });
    } else quit(false);
  };
  useCloseRequest(requestClose);
  // The log out that asked was cancelled: the window no longer closes after the conflict is settled.
  // The conflict itself is still a question (which text wins), so its sheet stays, as one that doesn't close.
  useCloseWithdrawn(() => {
    if (!closing.current) return;
    closing.current = false;
    setSheet((shown) => (shown?.kind === "conflict" && shown.after === "close" ? { kind: "conflict", after: null } : shown));
  });
  const afterConflict = (): void => {
    if (closing.current && !model.getSnapshot().conflict) quit(false);
    else closeSheet();
  };

  const openPath = (path: string): string | null => {
    if (path === state.path) return null;
    if (!model.isPristine) newWindow([path]);
    else if (!model.open(path)) return model.getSnapshot().notice?.text ?? "It couldn't be opened.";
    return null;
  };
  // Open and Save As are Files' own chooser over the window (apps/files/chooser/), never a typed path (PA-12).
  const chooseOpen = (path: string): void => {
    // A failed open says why in the notice.
    openPath(path);
    closeSheet();
  };
  const chooseSaveAs = (path: string): void => {
    // The chooser already asked before replacing a file; a failed save says why in the notice.
    if (model.saveAs(path) && closing.current) return quit(false);
    closeSheet();
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: one request per sheet shown
  const chooser = useMemo(() => {
    if (sheet?.kind === "open") return chooserRequest("open", { appId: "dev.dashi.editor", title: "Open", currentFolder: base });
    if (sheet?.kind !== "save-as") return null;
    const home = homeFolder();
    const suggested = resolveInput(suggestedSavePath(state.path, home, existsSync(join(home, "Documents")), existsSync), base, home);
    return chooserRequest("save", {
      appId: "dev.dashi.editor",
      title: state.path === null ? `Save “${name}”` : "Save As",
      currentFolder: suggested ? dirname(suggested) : base,
      currentName: suggested ? basename(suggested) : `${name}.txt`,
    });
  }, [sheet]);

  return { sheet, setSheet, chooser, closing, closeSheet, save, requestClose, afterConflict, openPath, chooseOpen, chooseSaveAs };
}
