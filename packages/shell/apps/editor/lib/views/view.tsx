/**
 * Text Editor's window: the unified toolbar with the document's name and, on
 * the same line and muted, its folder (or "Draft"); then New, Open, Save, and
 * the Find field, with Find's place in it ("2 of 4"). The name gives way
 * before the controls do, and the window is never narrower than they need
 * (EDITOR_MIN_SIZE). The text, with Find's matches washed and line numbers
 * in a gutter; the counts, and an encoding or line ending that isn't UTF-8
 * and LF, in a quiet chip at its foot; and a notice over it when something
 * needs saying.
 * Each window is its own process with one document, as Preview's are: New
 * opens another window, and Open (or files dropped on the window) opens in
 * this one only while it is an untouched Untitled.
 *
 * This file is the layout: the jobs are hooks (use-selection.ts, use-editor-sheets.ts,
 * use-editor-menus.ts) and the parts are toolbar.tsx, overlay.tsx and content.tsx.
 *
 * Nothing asks before closing: the document saves on its own (main.tsx), and
 * an Untitled one is kept as a draft. The one question is when the file was
 * changed by another app while there were changes here.
 */

import { AppWindow, Notice } from "@dashi/ui";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { EditorModel } from "../model.ts";
import { displayName, folderLabel } from "../names.ts";
import { titleDetail } from "../status.ts";
import { useEditorMenus } from "../use-editor-menus.ts";
import { useEditorSheets } from "../use-editor-sheets.ts";
import { useSelection } from "../use-selection.ts";
import { EditorContent, useLineCount } from "./content.tsx";
import { editorOverlay } from "./overlay.tsx";
import { EditorToolbar } from "./toolbar.tsx";

export const EDITOR_SIZE = { width: 760, height: 600 } as const;
/**
 * The smallest the window gets (LA-3): New, Open, Save and a 120 pt Find
 * field, with room for the start of the name; the chooser and every sheet
 * fit it. A half-screen tile on the smallest screen is wider.
 */
export const EDITOR_MIN_SIZE = { width: 480, height: 320 } as const;
export interface EditorWindowProps {
  model: EditorModel;
  /** Closes the window; `discard` deletes its draft instead of keeping it (recovery.ts). */
  quit: (discard: boolean) => void;
  /** Opens another window, with these files (none: Untitled). */
  newWindow: (files: readonly string[]) => void;
  /** Types a chord into the window (GPUI's spelling, "ctrl-v"): Cut, Copy, Paste, and Select All reach the input this way. */
  press: (keystroke: string) => void;
  scroll: (dy: number, fromTop: boolean) => void;
  /** Gives the text the keyboard back, the caret where it was (after a sheet, Esc in Find, a Save from the toolbar). */
  focusText: () => void;
  /** Names the window after its document: the Window menu, the switcher, and the Dock's list show it. */
  setTitle: (title: string) => void;
}

export function EditorWindow({ model, quit, newWindow, press, scroll, focusText, setTitle }: EditorWindowProps) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  // Bumped to give the keyboard to the Find field (it is mounted again).
  const [findFocus, setFindFocus] = useState(0);
  const name = displayName(state.path);
  const lines = useLineCount(state.text);
  const selection = useSelection(model, state);
  const sheets = useEditorSheets({ model, state, name, quit, newWindow, focusText });
  useEffect(() => {
    setTitle(name);
  }, [name, setTitle]);
  useEditorMenus({ model, state, selection, sheets, newWindow, press, focusFind: () => setFindFocus((n) => n + 1) });

  // One chrome row: the folder is the muted words after the title, and Find's place is in its field. The counts
  // wait in a chip at the text's foot; a notice floats over the text until dismissed, and the chip makes way for it.
  const notice = state.notice ? <Notice tone={state.notice.tone} text={state.notice.text} onDismiss={() => model.dismissNotice()} /> : undefined;
  return (
    <AppWindow
      title={name}
      detail={titleDetail(folderLabel(state.path))}
      toolbar={
        <EditorToolbar model={model} state={state} sheets={sheets} newWindow={newWindow} findFocus={findFocus} jump={selection.jump} focusText={focusText} />
      }
      overlay={editorOverlay({ model, state, name, lines, sheets, goToLine: selection.goToLine, quit })}
      notice={notice}
    >
      <EditorContent
        model={model}
        state={state}
        lines={lines}
        selection={selection}
        hasNotice={notice !== undefined}
        openPath={sheets.openPath}
        newWindow={newWindow}
        scroll={scroll}
      />
    </AppWindow>
  );
}
