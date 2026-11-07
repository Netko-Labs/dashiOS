/**
 * Text Editor's menus in the menu bar (the kit's `useAppMenus`): File (new
 * window, open, save, close), Edit (Undo on the app's own history; Cut,
 * Copy, Paste, and Select All typed into the field with the keyboard, as its
 * own keys would be; Find), and View (the font). The ❖ shortcuts are real:
 * the shell matches a pressed chord against the enabled rows
 * (app-menus/shortcut.ts), and a chord no enabled row shows reaches the
 * field as its Ctrl chord, so ❖C still copies in the Find field while the
 * text has nothing selected. Cut and Copy are enabled while text is
 * selected. The shell offers ❖W to the app's own row first, so ❖W is Close,
 * which asks before it drops changes; ❖Q stays the shell's.
 */

import { redoLabel, undoLabel } from "@dashi/ui";
import { enabledIds, type MenuSpec } from "../kit/index.ts";

export interface MenuContext {
  dirty: boolean;
  hasFile: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** Text is selected in the document: Cut and Copy have something to take. */
  hasSelection: boolean;
  /** What Undo and Redo would take back ("Typing", "Replace All"): the rows say so, as every app's do. */
  undoName?: string | null;
  redoName?: string | null;
  hasMatches: boolean;
  monospace: boolean;
  caseSensitive: boolean;
  actions: {
    newWindow(): void;
    open(): void;
    close(): void;
    save(): void;
    saveAs(): void;
    revert(): void;
    undo(): void;
    redo(): void;
    cut(): void;
    copy(): void;
    paste(): void;
    selectAll(): void;
    find(): void;
    findNext(step: 1 | -1): void;
    replace(): void;
    toggleCase(): void;
    toggleMonospace(): void;
    fontSize(step: 1 | -1 | 0): void;
  };
}

export function editorMenus(context: MenuContext): { menus: MenuSpec[]; run: (id: string) => void } {
  const { actions } = context;
  const menus: MenuSpec[] = [
    {
      id: "file",
      items: [
        { id: "new", label: "New", shortcut: "❖N" },
        { id: "open", label: "Open…", shortcut: "❖O" },
        { type: "separator" },
        { id: "close", label: "Close", shortcut: "❖W" },
        { id: "save", label: "Save", shortcut: "❖S", enabled: context.dirty || !context.hasFile },
        { id: "save-as", label: "Save As…", shortcut: "⇧❖S" },
        { id: "revert", label: "Revert to Saved…", enabled: context.dirty && context.hasFile },
      ],
    },
    {
      id: "edit",
      items: [
        { id: "undo", label: undoLabel(context.canUndo ? context.undoName : null), shortcut: "❖Z", enabled: context.canUndo },
        { id: "redo", label: redoLabel(context.canRedo ? context.redoName : null), shortcut: "⇧❖Z", enabled: context.canRedo },
        { type: "separator" },
        { id: "cut", label: "Cut", shortcut: "❖X", enabled: context.hasSelection },
        { id: "copy", label: "Copy", shortcut: "❖C", enabled: context.hasSelection },
        { id: "paste", label: "Paste", shortcut: "❖V" },
        { id: "select-all", label: "Select All", shortcut: "❖A" },
        { type: "separator" },
        { id: "find", label: "Find…", shortcut: "❖F" },
        { id: "find-next", label: "Find Next", shortcut: "❖G", enabled: context.hasMatches },
        { id: "find-previous", label: "Find Previous", shortcut: "⇧❖G", enabled: context.hasMatches },
        { id: "replace", label: "Find and Replace…" },
        { id: "match-case", label: "Match Case", checked: context.caseSensitive },
      ],
    },
    {
      id: "view",
      items: [
        { id: "monospace", label: "Monospaced Font", shortcut: "⇧❖T", checked: context.monospace },
        { type: "separator" },
        { id: "bigger", label: "Bigger", shortcut: "❖=" },
        { id: "smaller", label: "Smaller", shortcut: "❖-" },
        { id: "actual-size", label: "Actual Size", shortcut: "❖0" },
      ],
    },
  ];

  const handlers: Readonly<Record<string, () => void>> = {
    new: actions.newWindow,
    open: actions.open,
    close: actions.close,
    save: actions.save,
    "save-as": actions.saveAs,
    revert: actions.revert,
    undo: actions.undo,
    redo: actions.redo,
    cut: actions.cut,
    copy: actions.copy,
    paste: actions.paste,
    "select-all": actions.selectAll,
    find: actions.find,
    "find-next": () => actions.findNext(1),
    "find-previous": () => actions.findNext(-1),
    replace: actions.replace,
    "match-case": actions.toggleCase,
    monospace: actions.toggleMonospace,
    bigger: () => actions.fontSize(1),
    smaller: () => actions.fontSize(-1),
    "actual-size": () => actions.fontSize(0),
  };
  const run = (id: string): void => {
    if (enabledIds(menus).has(id)) handlers[id]?.();
  };
  return { menus, run };
}
