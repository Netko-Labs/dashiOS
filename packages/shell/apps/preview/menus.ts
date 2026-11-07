/**
 * Preview's menus in the menu bar (the kit's `useAppMenus`), after the Mac's
 * Preview: File (open, the recent files, open with, show in Files, export,
 * print, info, trash), Edit (copy, select all, copy the path), View (zoom,
 * the sidebar), Tools (rotate), and Go (the folder's pictures, or a PDF's
 * pages). The ❖ shortcuts are real: the shell matches a ❖ chord against the
 * focused app's enabled rows (app-menus/shortcut.ts), so a row that cannot
 * run now has no key either. Rows that show a bare key (⌫, ← →) say what
 * the window's own keys do (keys.ts). The menu bar has no submenus yet, so
 * Open Recent is a run of rows under Open….
 * Not on the Mac's keys: Move to Trash (❖⌫), whose chord the keymap keeps
 * for itself (app-menus/reserved.ts); ⌫ asks instead.
 */

import { basename, dirname } from "node:path";
import { enabledIds, type MenuItemSpec, type MenuSpec } from "../kit/index.ts";

export interface PreviewMenuContext {
  /** A file is open. */
  hasFile: boolean;
  /** Something is on screen to look at. */
  hasPicture: boolean;
  isPdf: boolean;
  /** It can be rotated. */
  canTurn: boolean;
  canPrevious: boolean;
  canNext: boolean;
  /** The system clipboard can be written (the kit's clipboard). */
  canCopy: boolean;
  /** Text is selected in the PDF. */
  hasSelection: boolean;
  canExport: boolean;
  canPrint: boolean;
  /** The page strip is showing. */
  sidebar: boolean;
  /** The recent files, newest first (paths). */
  recents: readonly string[];
  /** A sheet or a menu holds the window: nothing is chosen under it. */
  blocked: boolean;
  actions: {
    /** Asks for a file to open (the desktop's file chooser). */
    open(): void;
    openRecent(path: string): void;
    clearRecents(): void;
    openWith(): void;
    showInFiles(): void;
    exportFile(): void;
    print(): void;
    info(): void;
    trash(): void;
    copy(): void;
    selectAll(): void;
    copyPath(): void;
    actualSize(): void;
    zoomIn(): void;
    zoomOut(): void;
    zoomToFit(): void;
    zoomToWidth(): void;
    toggleSidebar(): void;
    rotate(direction: 1 | -1): void;
    step(delta: 1 | -1): void;
  };
}

/** How many recent files File lists. */
export const RECENT_ROWS = 5;

// Control characters and the bidi overrides that could make a label read as another; the menus channel refuses them.
const UNSAFE = /[\p{Cc}‪-‮⁦-⁩]/gu;

/** A recent file's row label: its name, and its folder's name when two have the same name; never more than a menu takes. */
export function recentLabels(paths: readonly string[]): string[] {
  const names = paths.map((path) => basename(path));
  return paths.map((path, index) => {
    const name = names[index] as string;
    const twin = names.some((other, at) => at !== index && other === name);
    const label = (twin ? `${name} — ${basename(dirname(path))}` : name).replace(UNSAFE, "?").trim() || "Untitled";
    return [...label].length > 78 ? `${[...label].slice(0, 77).join("")}…` : label;
  });
}

/** The menus, and what choosing each row does. */
export function previewMenus(context: PreviewMenuContext): { menus: MenuSpec[]; run: (id: string) => void } {
  const { actions, blocked, hasFile, hasPicture, isPdf } = context;
  const open = hasFile && !blocked;
  const seeing = hasPicture && !blocked;
  const unit = isPdf ? "Page" : "Image";
  const recents = context.recents.slice(0, RECENT_ROWS);
  const recentRows: MenuItemSpec[] = recentLabels(recents).map((label, index) => ({ id: `recent-${index}`, label, enabled: !blocked }));

  const menus: MenuSpec[] = [
    {
      id: "file",
      items: [
        { id: "open", label: "Open…", shortcut: "❖O", enabled: !blocked },
        ...(recentRows.length > 0
          ? ([
              { type: "separator" },
              ...recentRows,
              { id: "clear-recents", label: "Clear Recents", enabled: !blocked },
              { type: "separator" },
            ] as MenuItemSpec[])
          : []),
        { id: "open-with", label: "Open With…", enabled: open },
        { id: "show-in-files", label: "Show in Files", enabled: open },
        { type: "separator" },
        { id: "export", label: "Export…", shortcut: "⇧❖E", enabled: context.canExport && seeing },
        { id: "print", label: "Print…", shortcut: "❖P", enabled: context.canPrint && seeing },
        { type: "separator" },
        { id: "info", label: "Get Info", shortcut: "❖I", enabled: seeing },
        { type: "separator" },
        { id: "trash", label: "Move to Trash…", shortcut: "⌫", enabled: open },
      ],
    },
    {
      id: "edit",
      items: [
        { id: "copy", label: "Copy", shortcut: "❖C", enabled: seeing && context.canCopy },
        { id: "select-all", label: "Select All", shortcut: "❖A", enabled: seeing && isPdf },
        { type: "separator" },
        { id: "copy-path", label: "Copy Path", shortcut: "⇧❖C", enabled: open && context.canCopy },
      ],
    },
    {
      id: "view",
      items: [
        { id: "sidebar", label: "Sidebar", checked: context.sidebar, enabled: open },
        { type: "separator" },
        { id: "actual", label: "Actual Size", shortcut: "❖0", enabled: seeing },
        { id: "fit", label: "Zoom to Fit", shortcut: "❖9", enabled: seeing },
        ...(isPdf ? ([{ id: "fit-width", label: "Zoom to Width", enabled: seeing }] as MenuItemSpec[]) : []),
        { id: "zoom-in", label: "Zoom In", shortcut: "❖=", enabled: seeing },
        { id: "zoom-out", label: "Zoom Out", shortcut: "❖-", enabled: seeing },
      ],
    },
    {
      id: "tools",
      title: "Tools",
      items: [
        { id: "rotate-left", label: "Rotate Left", shortcut: "❖L", enabled: context.canTurn && seeing },
        { id: "rotate-right", label: "Rotate Right", shortcut: "❖R", enabled: context.canTurn && seeing },
      ],
    },
    {
      id: "go",
      title: "Go",
      items: [
        { id: "previous", label: `Previous ${unit}`, shortcut: "←", enabled: context.canPrevious && !blocked },
        { id: "next", label: `Next ${unit}`, shortcut: "→", enabled: context.canNext && !blocked },
      ],
    },
  ];

  const simple: Readonly<Record<string, () => void>> = {
    open: actions.open,
    "clear-recents": actions.clearRecents,
    "open-with": actions.openWith,
    "show-in-files": actions.showInFiles,
    export: actions.exportFile,
    print: actions.print,
    info: actions.info,
    trash: actions.trash,
    copy: actions.copy,
    "select-all": actions.selectAll,
    "copy-path": actions.copyPath,
    sidebar: actions.toggleSidebar,
    actual: actions.actualSize,
    fit: actions.zoomToFit,
    "fit-width": actions.zoomToWidth,
    "zoom-in": actions.zoomIn,
    "zoom-out": actions.zoomOut,
    "rotate-left": () => actions.rotate(-1),
    "rotate-right": () => actions.rotate(1),
    previous: () => actions.step(-1),
    next: () => actions.step(1),
  };

  const run = (id: string): void => {
    if (!enabledIds(menus).has(id)) return;
    const recent = /^recent-(\d)$/.exec(id);
    if (recent) {
      const path = recents[Number(recent[1])];
      if (path) actions.openRecent(path);
      return;
    }
    simple[id]?.();
  };
  return { menus, run };
}
