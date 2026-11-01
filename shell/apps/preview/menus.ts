/**
 * Preview's menus in the menu bar (the kit's `useAppMenus`), after the Mac's
 * Preview: File (open, open with, show in Files, info, save a turned copy, trash),
 * Edit (copy the path), View (zoom, and the PDF's thumbnails), Tools (turn),
 * and Go (the folder's images, or a PDF's pages). The shortcuts are real: the
 * shell matches a ❖ chord against the focused app's enabled rows
 * (app-menus/shortcut.ts), so a row that cannot run now has no key either.
 * Not on the Mac's keys: Thumbnails (⌥❖2) and Move to Trash (❖⌫), whose chords
 * the keymap keeps for itself (app-menus/reserved.ts); Backspace still asks to
 * trash, as it always did.
 */

import { enabledIds, type MenuSpec } from "../kit/index.ts";

export interface PreviewMenuContext {
  /** A file is open. */
  hasFile: boolean;
  /** Something is on screen to look at. */
  hasPicture: boolean;
  isPdf: boolean;
  /** The view can be turned. */
  canTurn: boolean;
  /** A copy with the turn applied can be saved. */
  canSaveCopy: boolean;
  canPrevious: boolean;
  canNext: boolean;
  /** The system clipboard can be written (the kit's clipboard). */
  canCopy: boolean;
  /** The PDF's page strip is showing. */
  thumbnails: boolean;
  /** A sheet or a menu holds the window: nothing is chosen under it. */
  blocked: boolean;
  actions: {
    /** Asks for a file to open (the desktop's file chooser). */
    open(): void;
    openWith(): void;
    showInFiles(): void;
    info(): void;
    saveCopy(): void;
    trash(): void;
    copyPath(): void;
    actualSize(): void;
    zoomIn(): void;
    zoomOut(): void;
    zoomToFit(): void;
    toggleThumbnails(): void;
    rotate(direction: 1 | -1): void;
    step(delta: 1 | -1): void;
  };
}

/** The menus, and what choosing each row does. */
export function previewMenus(context: PreviewMenuContext): { menus: MenuSpec[]; run: (id: string) => void } {
  const { actions, blocked, hasFile, hasPicture, isPdf } = context;
  const open = hasFile && !blocked;
  const seeing = hasPicture && !blocked;
  const unit = isPdf ? "Page" : "Image";

  const menus: MenuSpec[] = [
    {
      id: "file",
      items: [
        { id: "open", label: "Open…", shortcut: "❖O", enabled: !blocked },
        { id: "open-with", label: "Open With…", enabled: open },
        { id: "show-in-files", label: "Show in Files", enabled: open },
        { type: "separator" },
        { id: "info", label: "Get Info", shortcut: "❖I", enabled: seeing },
        { id: "save-copy", label: "Save Turned Copy", enabled: context.canSaveCopy && !blocked },
        { type: "separator" },
        { id: "trash", label: "Move to Trash…", shortcut: "⌫", enabled: open },
      ],
    },
    { id: "edit", items: [{ id: "copy-path", label: "Copy Path", shortcut: "⇧❖C", enabled: open && context.canCopy }] },
    {
      id: "view",
      items: [
        { id: "actual", label: "Actual Size", shortcut: "❖0", enabled: seeing },
        { id: "zoom-in", label: "Zoom In", shortcut: "❖=", enabled: seeing },
        { id: "zoom-out", label: "Zoom Out", shortcut: "❖-", enabled: seeing },
        { id: "fit", label: "Zoom to Fit", shortcut: "❖9", enabled: seeing },
        { type: "separator" },
        { id: "thumbnails", label: "Thumbnails", checked: isPdf && context.thumbnails, enabled: isPdf && !blocked },
      ],
    },
    {
      id: "tools",
      title: "Tools",
      items: [
        { id: "rotate-left", label: "Rotate Left", shortcut: "❖L", enabled: context.canTurn && !blocked },
        { id: "rotate-right", label: "Rotate Right", shortcut: "❖R", enabled: context.canTurn && !blocked },
      ],
    },
    {
      id: "go",
      title: "Go",
      items: [
        { id: "previous", label: `Previous ${unit}`, shortcut: "❖[", enabled: context.canPrevious && !blocked },
        { id: "next", label: `Next ${unit}`, shortcut: "❖]", enabled: context.canNext && !blocked },
      ],
    },
  ];

  const run = (id: string): void => {
    if (!enabledIds(menus).has(id)) return;
    switch (id) {
      case "open":
        return actions.open();
      case "open-with":
        return actions.openWith();
      case "show-in-files":
        return actions.showInFiles();
      case "info":
        return actions.info();
      case "save-copy":
        return actions.saveCopy();
      case "trash":
        return actions.trash();
      case "copy-path":
        return actions.copyPath();
      case "actual":
        return actions.actualSize();
      case "zoom-in":
        return actions.zoomIn();
      case "zoom-out":
        return actions.zoomOut();
      case "fit":
        return actions.zoomToFit();
      case "thumbnails":
        return actions.toggleThumbnails();
      case "rotate-left":
        return actions.rotate(-1);
      case "rotate-right":
        return actions.rotate(1);
      case "previous":
        return actions.step(-1);
      case "next":
        return actions.step(1);
    }
  };
  return { menus, run };
}
