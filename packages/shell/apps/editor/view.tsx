/**
 * Text Editor's window: the unified toolbar with the document's name and, on
 * the same line and muted, its folder (or "Draft"), the counts or Find's
 * place, and an encoding or line ending that isn't UTF-8 and LF; then New,
 * Open, Save, and the Find field; the text, with Find's matches washed and
 * line numbers in a gutter; and a notice over it when something needs saying.
 * Each window is its own process with one document, as Preview's are: New
 * opens another window, and Open (or files dropped on the window) opens in
 * this one only while it is an untouched Untitled.
 *
 * Nothing asks before closing: the document saves on its own (main.tsx), and
 * an Untitled one is kept as a draft. The one question is when the file was
 * changed by another app while there were changes here.
 */

import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { AppWindow, ConfirmSheet, Notice, SearchField, ToolbarButton, useColors } from "@dashi/ui";
import { type TextSelection, View } from "@mirinjs/metal";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useAppMenus, useCloseRequest } from "../kit/index.ts";
import { lineCount, lineOf, lineStart } from "./find.ts";
import { NEW, OPEN, SAVE } from "./glyphs.ts";
import { editorMenus } from "./menus.ts";
import type { EditorModel } from "./model.ts";
import { displayName, folderLabel, resolveInput, suggestedSavePath, tildePath } from "./names.ts";
import { ConflictSheet, GoToLineSheet, PathSheet, ReplaceSheet, type SheetState, VersionsSheet } from "./sheets.tsx";
import { formatStats, textStats } from "./stats.ts";
import { findHighlights, findStatus, statusLine } from "./status.ts";
import { TextArea } from "./text-area.tsx";
import { versionDifference } from "./versions.ts";

export const EDITOR_SIZE = { width: 760, height: 600 } as const;

/** How long the counts wait for typing to pause before counting again. */
const COUNT_DELAY_MS = 300;

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

const isFolder = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/** Why a typed path can't be opened, or null when it can. */
function openProblem(path: string): string | null {
  try {
    const stat = statSync(path);
    if (stat.isDirectory()) return "That is a folder. Type the path of a file in it.";
    return stat.isFile() ? null : "That isn't a regular file.";
  } catch {
    return "There is no file there.";
  }
}

/** `value`, once it has stayed the same for `ms`. */
function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

export function EditorWindow({ model, quit, newWindow, press, scroll, focusText, setTitle }: EditorWindowProps) {
  const colors = useColors();
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const [sheet, setSheet] = useState<SheetState | null>(null);
  // The caret and selection, per document: as the input reported it, or where Find or Go to Line moved it.
  const [selected, setSelected] = useState<TextSelection & { session: number }>({ session: state.session, start: 0, end: 0 });
  const selection = selected.session === state.session ? selected : { start: state.text.length, end: state.text.length };
  const select = (start: number, end: number): void => setSelected({ session: state.session, start, end });
  // Bumped to give the keyboard to the Find field (it is mounted again).
  const [findFocus, setFindFocus] = useState(0);
  const closing = useRef(false);

  const name = displayName(state.path);
  const base = state.path !== null ? dirname(state.path) : homedir();
  const counted = useSettled(state.text, COUNT_DELAY_MS);
  const stats = useMemo(() => formatStats(textStats(counted)), [counted]);
  const lines = useMemo(() => lineCount(state.text), [state.text]);
  const { find } = state;
  const highlights = useMemo(() => findHighlights(find, colors.findWash, colors.findCurrent), [find, colors.findWash, colors.findCurrent]);
  useEffect(() => {
    setTitle(name);
  }, [name, setTitle]);
  // A change on disk while there were changes here asks which text wins.
  useEffect(() => {
    if (state.conflict && !sheet) setSheet({ kind: "conflict", after: null });
  }, [state.conflict, sheet]);

  // The text keeps its input (and its caret) through all of these: it is focused, never mounted again.
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
  const afterConflict = (): void => {
    if (closing.current && !model.getSnapshot().conflict) quit(false);
    else closeSheet();
  };

  /** Opens `path` here while this window is an untouched Untitled, else in a window of its own. */
  const openPath = (path: string): string | null => {
    if (path === state.path) return null;
    if (!model.isPristine) newWindow([path]);
    else if (!model.open(path)) return model.getSnapshot().notice?.text ?? "It couldn't be opened.";
    return null;
  };
  const submitOpen = (input: string): string | null => {
    const path = resolveInput(input, base);
    if (path === null) return "Type the path of a file.";
    const problem = openProblem(path) ?? openPath(path);
    if (problem) return problem;
    closeSheet();
    return null;
  };

  const saveTo = (path: string): string | null => {
    if (!model.saveAs(path)) return model.getSnapshot().notice?.text ?? "It couldn't be saved.";
    if (closing.current) quit(false);
    else closeSheet();
    return null;
  };
  const submitSaveAs = (input: string): string | null => {
    let path = resolveInput(input, base);
    if (path === null) return "Type where to save it.";
    if (isFolder(path)) path = join(path, state.path === null ? `${name}.txt` : name);
    if (path !== state.path && existsSync(path)) {
      setSheet({ kind: "replace-file", path });
      return null;
    }
    return saveTo(path);
  };

  /** Find's next or previous match: shown, scrolled to, and selected (the caret goes there). */
  const jump = (step: 1 | -1): void => {
    if (!model.findNext(step)) return;
    const { find: now } = model.getSnapshot();
    const start = now.matches[now.current] ?? 0;
    select(start, start + now.query.length);
  };
  const goToLine = (line: number): void => {
    const offset = lineStart(state.text, line);
    select(offset, offset);
    model.reveal(offset);
    closeSheet();
  };

  const versions = sheet?.kind === "versions" ? model.listVersions() : [];
  const { menus, run } = editorMenus({
    hasFile: state.path !== null,
    pristine: model.isPristine,
    hasVersions: state.path !== null,
    canUndo: state.canUndo,
    canRedo: state.canRedo,
    hasSelection: selection.start !== selection.end,
    undoName: state.undoName,
    redoName: state.redoName,
    hasMatches: find.matches.length > 0,
    monospace: state.prefs.monospace,
    lineNumbers: state.prefs.lineNumbers,
    caseSensitive: find.caseSensitive,
    actions: {
      newWindow: () => newWindow([]),
      open: () => setSheet({ kind: "open" }),
      close: requestClose,
      save,
      saveAs: () => setSheet({ kind: "save-as" }),
      revertTo: () => setSheet({ kind: "versions" }),
      deleteDraft: () => setSheet({ kind: "delete-draft" }),
      undo: () => model.undo(),
      redo: () => model.redo(),
      cut: () => press("ctrl-x"),
      copy: () => press("ctrl-c"),
      paste: () => press("ctrl-v"),
      selectAll: () => press("ctrl-a"),
      find: () => setFindFocus((n) => n + 1),
      findNext: jump,
      replace: () => setSheet({ kind: "replace" }),
      goToLine: () => setSheet({ kind: "go-to-line" }),
      toggleCase: () => model.setCaseSensitive(!find.caseSensitive),
      toggleLineNumbers: () => model.setLineNumbers(!state.prefs.lineNumbers),
      toggleMonospace: () => model.setMonospace(!state.prefs.monospace),
      fontSize: (step) => model.stepFontSize(step),
    },
  });
  useAppMenus(menus, run);

  const toolbar = (
    <>
      <ToolbarButton testID="new" glyph={NEW} tooltip="New document" onPress={() => newWindow([])} />
      <ToolbarButton testID="open" glyph={OPEN} tooltip="Open" onPress={() => setSheet({ kind: "open" })} />
      <ToolbarButton testID="save" glyph={SAVE} tooltip={state.path === null ? "Save" : "Save a version"} disabled={model.isPristine} onPress={save} />
      <View style={{ width: 4 }} />
      <SearchField
        key={`find:${findFocus}`}
        testID="find"
        placeholder="Find"
        value={find.query}
        width={180}
        autoFocus={findFocus > 0}
        onChangeText={(query) => model.setQuery(query)}
        onSubmit={() => jump(1)}
        onKeyPress={(key) => {
          if (key === "Escape") focusText();
          else jump(key === "ArrowUp" ? -1 : 1);
        }}
      />
    </>
  );

  const overlay = (() => {
    if (!sheet) return undefined;
    switch (sheet.kind) {
      case "open":
        return (
          <PathSheet
            testID="open-sheet"
            title="Open"
            message="Type the path of the file to open, or drop a file on the window. ~ is your home folder."
            initial={base === "/" ? "/" : `${tildePath(base)}/`}
            action="Open"
            onSubmit={submitOpen}
            onCancel={closeSheet}
          />
        );
      case "save-as":
        return (
          <PathSheet
            testID="save-sheet"
            title={state.path === null ? `Save “${name}”` : "Save As"}
            message="Type where to save it. ~ is your home folder."
            initial={suggestedSavePath(state.path, homedir(), existsSync(join(homedir(), "Documents")))}
            action="Save"
            onSubmit={submitSaveAs}
            onCancel={closeSheet}
          />
        );
      case "replace-file":
        return (
          <ConfirmSheet
            testID="replace-file"
            title={`Replace “${displayName(sheet.path)}”?`}
            message={`A file with that name is already in ${tildePath(dirname(sheet.path))}. Replacing it overwrites what it holds.`}
            confirmLabel="Replace"
            danger
            onConfirm={() => saveTo(sheet.path)}
            onCancel={() => setSheet({ kind: "save-as" })}
          />
        );
      case "versions":
        return (
          <VersionsSheet
            name={name}
            versions={versions}
            now={Date.now()}
            describe={(version) => versionDifference(model.versionText(version) ?? "", state.text)}
            onRevert={(version) => {
              model.revertTo(version);
              closeSheet();
            }}
            onCancel={closeSheet}
          />
        );
      case "conflict":
        return state.conflict ? (
          <ConflictSheet
            name={name}
            conflict={state.conflict}
            closing={sheet.after === "close"}
            onKeepMine={() => {
              model.keepMine();
              afterConflict();
            }}
            onUseDisk={() => {
              model.revert("Use the One on Disk");
              afterConflict();
            }}
            onSaveAs={() => setSheet({ kind: "save-as" })}
            onCancel={() => {
              closing.current = false;
              closeSheet();
            }}
          />
        ) : undefined;
      case "delete-draft":
        return (
          <ConfirmSheet
            testID="delete-draft"
            title={`Delete the draft “${name}”?`}
            message="The window closes and its text is gone. You can't undo this."
            confirmLabel="Delete"
            danger
            onConfirm={() => quit(true)}
            onCancel={closeSheet}
          />
        );
      case "go-to-line":
        return <GoToLineSheet lines={lines} onGo={goToLine} onCancel={closeSheet} />;
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
    }
  })();

  // One chrome row: the folder, the counts (or Find's place), and an unusual encoding are muted words after the
  // title on its line, and a notice floats over the text until dismissed.
  const place = findStatus(find, () => lineOf(state.text, find.matches[find.current] ?? 0)) ?? stats;
  const detail = statusLine({ folder: folderLabel(state.path), place, encoding: state.encoding, lineEnding: state.lineEnding });
  const notice = state.notice ? <Notice tone={state.notice.tone} text={state.notice.text} onDismiss={() => model.dismissNotice()} /> : undefined;

  return (
    <AppWindow title={name} detail={detail} toolbar={toolbar} overlay={overlay} notice={notice}>
      <View
        style={{ flex: 1, flexDirection: "column" }}
        onDrop={(drop) => {
          if (drop.phase !== "drop" || drop.paths.length === 0) return;
          const [first, ...rest] = drop.paths;
          if (first !== undefined && openProblem(first) === null) openPath(first);
          if (rest.length > 0) newWindow(rest);
        }}
      >
        <TextArea
          text={state.text}
          prefs={state.prefs}
          lines={lines}
          session={state.session}
          selection={selection}
          onSelectionChange={(next) => select(next.start, next.end)}
          highlights={highlights}
          onChange={(text) => model.edit(text)}
          onEscape={() => find.query !== "" && model.setQuery("")}
          scroll={scroll}
          reveal={state.reveal}
        />
      </View>
    </AppWindow>
  );
}
