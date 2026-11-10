/**
 * The window's menu bar menus (menus.ts) and what each command does here.
 */

import { useAppMenus } from "../../kit/index.ts";
import { editorMenus } from "./menus.ts";
import type { EditorModel } from "./model.ts";
import type { EditorState } from "./state.ts";
import type { EditorSheets } from "./use-editor-sheets.ts";
import type { Selection } from "./use-selection.ts";

export function useEditorMenus({
  model,
  state,
  selection,
  sheets,
  newWindow,
  press,
  focusFind,
}: {
  model: EditorModel;
  state: EditorState;
  selection: Selection;
  sheets: EditorSheets;
  newWindow: (files: readonly string[]) => void;
  /** Types a chord into the window (GPUI's spelling, "ctrl-v"). */
  press: (keystroke: string) => void;
  /** Gives the keyboard to the Find field. */
  focusFind: () => void;
}): void {
  const { find } = state;
  const { setSheet } = sheets;
  const { menus, run } = editorMenus({
    hasFile: state.path !== null,
    pristine: model.isPristine,
    hasVersions: state.path !== null,
    canUndo: state.canUndo,
    canRedo: state.canRedo,
    hasSelection: selection.selection.start !== selection.selection.end,
    undoName: state.undoName,
    redoName: state.redoName,
    hasMatches: find.matches.length > 0,
    monospace: state.prefs.monospace,
    lineNumbers: state.prefs.lineNumbers,
    caseSensitive: find.caseSensitive,
    actions: {
      newWindow: () => newWindow([]),
      open: () => setSheet({ kind: "open" }),
      close: sheets.requestClose,
      save: sheets.save,
      saveAs: () => setSheet({ kind: "save-as" }),
      revertTo: () => setSheet({ kind: "versions" }),
      deleteDraft: () => setSheet({ kind: "delete-draft" }),
      undo: () => model.undo(),
      redo: () => model.redo(),
      cut: () => press("ctrl-x"),
      copy: () => press("ctrl-c"),
      paste: () => press("ctrl-v"),
      selectAll: () => press("ctrl-a"),
      find: focusFind,
      findNext: selection.jump,
      replace: () => setSheet({ kind: "replace" }),
      goToLine: () => setSheet({ kind: "go-to-line" }),
      toggleCase: () => model.setCaseSensitive(!find.caseSensitive),
      toggleLineNumbers: () => model.setLineNumbers(!state.prefs.lineNumbers),
      toggleMonospace: () => model.setMonospace(!state.prefs.monospace),
      fontSize: (step) => model.stepFontSize(step),
    },
  });
  useAppMenus(menus, run);
}
