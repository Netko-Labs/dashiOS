/**
 * What floats over the notes window: a sheet (a folder's name, a deletion)
 * or a menu at a point, which ends in an ellipsis past a width (PA-9).
 */

import { PopupMenu } from "@dashi/ui";
import type { ReactElement } from "react";
import type { Overlays } from "../hooks/use-overlays.ts";
import type { NotesModel } from "../model.ts";
import { NotesSheet } from "./sheets.tsx";

/** The widest a menu gets: a long folder's name ends in an ellipsis (PA-9). */
const MENU_MAX_WIDTH = 280;

export function notesOverlay(model: NotesModel, { sheet, menu, closeOverlay }: Overlays): ReactElement | undefined {
  if (sheet) {
    return (
      <NotesSheet
        sheet={sheet}
        onClose={closeOverlay}
        actions={{
          createFolder: (name) => {
            const made = model.createFolder(name);
            if (made !== null) model.setSource({ kind: "folder", name: made });
          },
          renameFolder: (from, to) => model.renameFolder(from, to),
          deleteFolder: (name) => model.deleteFolder(name),
          purge: () => model.purgeSelected(),
          emptyTrash: () => model.emptyTrash(),
        }}
      />
    );
  }
  if (menu) {
    return (
      <PopupMenu testID="menu" x={menu.x} y={menu.y} anchor={menu.anchor ?? "start"} maxWidth={MENU_MAX_WIDTH} items={menu.items} onClose={closeOverlay} />
    );
  }
  return undefined;
}
