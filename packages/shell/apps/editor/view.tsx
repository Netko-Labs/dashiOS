/**
 * Text Editor's window: the unified toolbar with the document's name (and
 * "Edited" while it has changes), a quiet line with its folder, the counts
 * or Find's place, and an encoding or line ending that isn't UTF-8 and LF,
 * then New, Open, Save, and the Find field; the text; and a notice over it
 * when something needs saying. Each window is its own process with one
 * document, as Preview's are: New opens another window, and Open opens in
 * this one only while it is an untouched Untitled.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { AppWindow, ConfirmSheet, Notice, SearchField, ToolbarButton, useColors } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AppChooser, chooserRequest } from "../files/chooser/index.ts";
import { useAppMenus, useCloseRequest } from "../kit/index.ts";
import { ENCODING_LABELS, LINE_ENDING_LABELS } from "./codec.ts";
import { lineOf } from "./find.ts";
import { NEW, OPEN, SAVE } from "./glyphs.ts";
import { editorMenus } from "./menus.ts";
import { type EditorModel, isDirty } from "./model.ts";
import { displayName, editedTitle, folderLabel, resolveInput, suggestedSavePath } from "./names.ts";
import { ReplaceSheet, type SheetState, UnsavedSheet } from "./sheets.tsx";
import { formatStats, textStats } from "./stats.ts";
import { TextArea } from "./text-area.tsx";

export const EDITOR_SIZE = { width: 760, height: 600 } as const;

export interface EditorWindowProps {
  model: EditorModel;
  /** Closes the window; `discard` drops what isn't saved instead of keeping it for later (recovery.ts). */
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

/** The home folder as the session gives it ($HOME), as Files' chooser takes it. */
const homeFolder = (): string => process.env.HOME || homedir();

export function EditorWindow({ model, quit, newWindow, press, scroll, focusText, setTitle }: EditorWindowProps) {
  const colors = useColors();
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const [sheet, setSheet] = useState<SheetState | null>(null);
  // Whether the document's text has a selection; a new document starts with none.
  const [selected, setSelected] = useState({ session: state.session, any: false });
  // Bumped to give the keyboard to the Find field (it is mounted again).
  const [findFocus, setFindFocus] = useState(0);

  const dirty = isDirty(state);
  const name = displayName(state.path);
  const base = state.path !== null ? dirname(state.path) : homeFolder();
  const stats = useMemo(() => formatStats(textStats(state.text)), [state.text]);
  const { find } = state;
  useEffect(() => {
    setTitle(name);
  }, [name, setTitle]);

  // The text keeps its input (and its caret) through all of these: it is focused, never mounted again.
  const closeSheet = (): void => {
    setSheet(null);
    focusText();
  };
  const save = (after: "close" | null): void => {
    const result = model.save();
    if (result === "needs-path") return setSheet({ kind: "save-as", after });
    if (result === "saved" && after === "close") return quit(false);
    closeSheet();
  };
  const requestClose = (): void => {
    if (dirty) setSheet({ kind: "unsaved", name });
    else quit(false);
  };
  // The close control, ❖Q, the Dock's Quit, logging out: as File › Close.
  useCloseRequest(requestClose);

  // Open and Save As are Files' own chooser over the window (apps/files/chooser/), never a typed path (PA-12).
  const chooseOpen = (path: string): void => {
    // A failed open says why in the notice.
    if (path !== state.path) {
      if (model.isPristine) model.open(path);
      else newWindow([path]);
    }
    closeSheet();
  };
  const chooseSaveAs = (path: string, after: "close" | null): void => {
    // The chooser already asked before replacing a file.
    if (model.saveAs(path) && after === "close") return quit(false);
    closeSheet();
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: one request per sheet shown
  const chooser = useMemo(() => {
    if (sheet?.kind === "open") return chooserRequest("open", { appId: "dev.dashi.editor", title: "Open", currentFolder: base });
    if (sheet?.kind !== "save-as") return null;
    const home = homeFolder();
    const suggested = resolveInput(suggestedSavePath(state.path, home, existsSync(join(home, "Documents"))), base, home);
    return chooserRequest("save", {
      appId: "dev.dashi.editor",
      title: sheet.after === "close" ? `Save “${name}”` : "Save As",
      currentFolder: suggested ? dirname(suggested) : base,
      currentName: suggested ? basename(suggested) : `${name}.txt`,
    });
  }, [sheet]);

  const { menus, run } = editorMenus({
    dirty,
    hasFile: state.path !== null,
    canUndo: state.canUndo,
    canRedo: state.canRedo,
    hasSelection: selected.session === state.session && selected.any,
    undoName: state.undoName,
    redoName: state.redoName,
    hasMatches: find.matches.length > 0,
    monospace: state.prefs.monospace,
    caseSensitive: find.caseSensitive,
    actions: {
      newWindow: () => newWindow([]),
      open: () => setSheet({ kind: "open" }),
      close: requestClose,
      save: () => save(null),
      saveAs: () => setSheet({ kind: "save-as", after: null }),
      revert: () => setSheet({ kind: "revert", name }),
      undo: () => model.undo(),
      redo: () => model.redo(),
      cut: () => press("ctrl-x"),
      copy: () => press("ctrl-c"),
      paste: () => press("ctrl-v"),
      selectAll: () => press("ctrl-a"),
      find: () => setFindFocus((n) => n + 1),
      findNext: (step) => model.findNext(step),
      replace: () => setSheet({ kind: "replace" }),
      toggleCase: () => model.setCaseSensitive(!find.caseSensitive),
      toggleMonospace: () => model.setMonospace(!state.prefs.monospace),
      fontSize: (step) => model.stepFontSize(step),
    },
  });
  useAppMenus(menus, run);

  const toolbar = (
    <>
      <ToolbarButton testID="new" glyph={NEW} onPress={() => newWindow([])} />
      <ToolbarButton testID="open" glyph={OPEN} onPress={() => setSheet({ kind: "open" })} />
      <ToolbarButton testID="save" glyph={SAVE} disabled={!dirty && state.path !== null} onPress={() => save(null)} />
      <View style={{ width: 4 }} />
      <SearchField
        key={`find:${findFocus}`}
        testID="find"
        placeholder="Find"
        value={find.query}
        width={180}
        autoFocus={findFocus > 0}
        onChangeText={(query) => model.setQuery(query)}
        onSubmit={() => model.findNext(1)}
        onKeyPress={(key) => {
          if (key === "Escape") focusText();
          else model.findNext(key === "ArrowUp" ? -1 : 1);
        }}
      />
    </>
  );

  const overlay = (() => {
    if (!sheet) return undefined;
    switch (sheet.kind) {
      case "open":
        return chooser && <AppChooser request={chooser} answer={(paths) => (paths?.[0] ? chooseOpen(paths[0]) : closeSheet())} />;
      case "save-as": {
        const after = sheet.after;
        return chooser && <AppChooser request={chooser} answer={(paths) => (paths?.[0] ? chooseSaveAs(paths[0], after) : closeSheet())} />;
      }
      case "unsaved":
        return <UnsavedSheet name={sheet.name} onSave={() => save("close")} onDiscard={() => quit(true)} onCancel={closeSheet} />;
      case "replace":
        return (
          <ReplaceSheet
            query={find.query}
            matches={find.matches.length}
            onQuery={(query) => model.setQuery(query)}
            onReplaceAll={(replacement) => model.replaceAll(replacement)}
            onCancel={closeSheet}
          />
        );
      case "revert":
        return (
          <ConfirmSheet
            testID="revert"
            title={`Revert “${sheet.name}” to the last saved version?`}
            message="Your changes since then are set aside. Edit › Undo brings them back."
            confirmLabel="Revert"
            onConfirm={() => {
              model.revert();
              closeSheet();
            }}
            onCancel={closeSheet}
          />
        );
    }
  })();

  const findStatus =
    find.query === ""
      ? null
      : find.matches.length === 0
        ? "Not found"
        : find.current < 0
          ? `${find.matches.length.toLocaleString("en-US")} ${find.matches.length === 1 ? "match" : "matches"}`
          : `${find.current + 1} of ${find.matches.length} · line ${lineOf(state.text, find.matches[find.current] ?? 0)}`;
  // One chrome row: the folder, the counts (or Find's place), and an unusual encoding are a quiet line in the
  // toolbar, and a notice floats over the text until dismissed.
  const encoding =
    state.encoding === "utf-8" && state.lineEnding === "lf" ? null : `${ENCODING_LABELS[state.encoding]} · ${LINE_ENDING_LABELS[state.lineEnding]}`;
  const status = [folderLabel(state.path), findStatus ?? stats, encoding].filter((part) => part !== null).join(" · ");
  const toolbarWithStatus = (
    <>
      <View style={{ flexShrink: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 11, color: colors.textMuted }}>
          {status}
        </Text>
      </View>
      {toolbar}
    </>
  );
  const notice = state.notice ? <Notice tone={state.notice.tone} text={state.notice.text} onDismiss={() => model.dismissNotice()} /> : undefined;

  return (
    <AppWindow title={editedTitle(state.path, dirty)} toolbar={toolbarWithStatus} overlay={overlay} notice={notice}>
      <TextArea
        text={state.text}
        prefs={state.prefs}
        session={state.session}
        onChange={(text) => model.edit(text)}
        onEscape={() => find.query !== "" && model.setQuery("")}
        onSelectionChange={(any) => setSelected({ session: state.session, any })}
        scroll={scroll}
        reveal={state.reveal}
      />
    </AppWindow>
  );
}
