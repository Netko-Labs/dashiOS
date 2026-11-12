/**
 * Notes' window: folders on the left (with their counts), the list of notes,
 * the note itself as one live page (its date and word count above it), and a
 * toolbar with the actions; an error or a conflict copy floats as a notice.
 * Every command is in the menu bar (menus.ts), with its ❖ chord. The keyboard
 * is the open field's while one is focused; otherwise it is the kit's
 * KeySink: N new note, Backspace delete (Edit › Undo brings it back), P pin,
 * Enter writes in the note, / or F search, and the up and down arrows move
 * through the list. Esc in a field gives the keyboard back to the list; Esc
 * in the search hands it to the note, on the match, when the note has one.
 * A narrow window folds the folders to a rail and narrows the list
 * (layout.ts); the notice floats at the foot of the note it is about.
 *
 * This file is the layout. The window's jobs are hooks (use-notes-data.ts,
 * use-overlays.ts, use-focus.ts, use-note-actions.ts, use-notes-menus.ts);
 * its parts are toolbar.tsx, overlay.tsx, content.tsx and sidebar.tsx.
 */

import { AppWindow } from "@dashi/ui";
import { View } from "@mirinjs/metal";
import { useState } from "react";
import { noteCount } from "../../../../src/shared/notes/index.ts";
import { useFocus } from "../hooks/use-focus.ts";
import { useNoteActions } from "../hooks/use-note-actions.ts";
import { useNotesData } from "../hooks/use-notes-data.ts";
import { useNotesMenus } from "../hooks/use-notes-menus.ts";
import { useOverlays } from "../hooks/use-overlays.ts";
import { notesLayout, RAIL_WIDTH } from "../layout.ts";
import type { NotesModel } from "../model.ts";
import { NotesContent, type NotesHost, noticeFor } from "./content.tsx";
import { notesOverlay } from "./overlay.tsx";
import { Sidebar } from "./sidebar.tsx";
import { NotesToolbar } from "./toolbar.tsx";

export const NOTES_SIZE = { width: 980, height: 640 } as const;

export function NotesWindow({ model, host }: { model: NotesModel; host: NotesHost }) {
  // The window's width: a narrow one folds the folders to a rail and narrows the list (layout.ts).
  const [windowWidth, setWindowWidth] = useState(0);
  const layout = notesLayout(windowWidth);
  const data = useNotesData(model);
  const overlays = useOverlays();
  const focus = useFocus();
  const actions = useNoteActions({ model, data, overlays, focusBody: focus.focusBody });
  useNotesMenus({ model, data, overlays, focus, actions, press: host.press });
  const { state } = data;

  // One chrome row: the count follows the title on its line (and the sidebar's badges), the words follow the note's date.
  return (
    <View
      testID="notes-window"
      style={{ flex: 1, flexDirection: "column" }}
      onLayout={(bounds) => setWindowWidth((was) => (was === Math.round(bounds.width) ? was : Math.round(bounds.width)))}
    >
      <AppWindow
        title={data.title}
        detail={noteCount(data.rows.length)}
        toolbar={<NotesToolbar model={model} data={data} overlays={overlays} focus={focus} actions={actions} compact={layout.compact} />}
        overlay={notesOverlay(model, overlays)}
        {...(layout.rail ? { sidebarWidth: RAIL_WIDTH } : {})}
        sidebar={
          <Sidebar
            rail={layout.rail}
            folders={state.folders}
            counts={data.counts}
            source={state.source}
            onSource={(source) => {
              model.setSource(source);
              overlays.takeKeys();
            }}
            onNewFolder={() => overlays.setSheet({ kind: "new-folder" })}
            onFolderMenu={actions.openFolderMenu}
          />
        }
      >
        <NotesContent
          model={model}
          host={host}
          data={data}
          overlays={overlays}
          focus={focus}
          actions={actions}
          listWidth={layout.listWidth}
          windowWidth={windowWidth}
          notice={noticeFor(model, data)}
        />
      </AppWindow>
    </View>
  );
}
