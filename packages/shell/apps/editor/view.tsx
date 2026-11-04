/**
 * Text Editor's window: the unified toolbar with the document's name (and
 * "Edited" while it has changes), its folder, New, Open, Save, and the Find
 * field; the text; and a footer with the counts, Find's place, and the
 * encoding and line endings. Each window is its own process with one
 * document, as Preview's are: New opens another window, and Open opens in
 * this one only while it is an untouched Untitled.
 */

import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { AppWindow, SearchField, ToolbarButton, useColors } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Clipboard } from "../kit/index.ts";
import { useAppMenus } from "../kit/index.ts";
import { ENCODING_LABELS, LINE_ENDING_LABELS } from "./codec.ts";
import { lineOf } from "./find.ts";
import { NEW, OPEN, SAVE } from "./glyphs.ts";
import { editorMenus } from "./menus.ts";
import { type EditorModel, isDirty } from "./model.ts";
import { displayName, editedTitle, folderLabel, resolveInput, suggestedSavePath, tildePath } from "./names.ts";
import { PathSheet, ReplaceSheet, type SheetState, UnsavedSheet } from "./sheets.tsx";
import { formatStats, textStats } from "./stats.ts";
import { TextArea } from "./text-area.tsx";

export const EDITOR_SIZE = { width: 760, height: 600 } as const;

export interface EditorWindowProps {
  model: EditorModel;
  clipboard: Clipboard;
  /** Closes the window; `discard` drops what isn't saved instead of keeping it for later (recovery.ts). */
  quit: (discard: boolean) => void;
  /** Opens another window, with these files (none: Untitled). */
  newWindow: (files: readonly string[]) => void;
  /** Types a chord into the window (GPUI's spelling, "ctrl-v"): Paste and Select All reach the input this way. */
  press: (keystroke: string) => void;
  scroll: (dy: number, fromTop: boolean) => void;
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

export function EditorWindow({ model, clipboard, quit, newWindow, press, scroll }: EditorWindowProps) {
  const colors = useColors();
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const [sheet, setSheet] = useState<SheetState | null>(null);
  // Bumped to give the keyboard to the text, or to the Find field.
  const [textFocus, setTextFocus] = useState(0);
  const [findFocus, setFindFocus] = useState(0);
  // Save As asks once before it replaces another file: this is the path it asked about.
  const replacing = useRef<string | null>(null);

  const dirty = isDirty(state);
  const name = displayName(state.path);
  const base = state.path !== null ? dirname(state.path) : homedir();
  const stats = useMemo(() => formatStats(textStats(state.text)), [state.text]);
  const { find } = state;

  const closeSheet = (): void => {
    setSheet(null);
    setTextFocus((n) => n + 1);
  };
  const save = (after: "close" | null): void => {
    const result = model.save();
    if (result === "needs-path") return setSheet({ kind: "save-as", after });
    setSheet(null);
    if (result === "saved" && after === "close") quit(false);
    else setTextFocus((n) => n + 1);
  };
  const requestClose = (): void => {
    if (dirty) setSheet({ kind: "unsaved", name });
    else quit(false);
  };

  const submitOpen = (input: string): string | null => {
    const path = resolveInput(input, base);
    if (path === null) return "Type the path of a file.";
    const problem = openProblem(path);
    if (problem) return problem;
    if (path !== state.path) {
      if (model.isPristine) {
        if (!model.open(path)) return model.getSnapshot().notice?.text ?? "It couldn't be opened.";
      } else newWindow([path]);
    }
    closeSheet();
    return null;
  };

  const submitSaveAs = (input: string, after: "close" | null): string | null => {
    let path = resolveInput(input, base);
    if (path === null) return "Type where to save it.";
    if (isFolder(path)) path = join(path, state.path === null ? `${name}.txt` : name);
    if (path !== state.path && existsSync(path) && replacing.current !== path) {
      replacing.current = path;
      return `“${displayName(path)}” already exists in ${tildePath(dirname(path))}. Choose Save again to replace it.`;
    }
    replacing.current = null;
    if (!model.saveAs(path)) return model.getSnapshot().notice?.text ?? "It couldn't be saved.";
    if (after === "close") quit(false);
    else closeSheet();
    return null;
  };

  const { menus, run } = editorMenus({
    dirty,
    hasFile: state.path !== null,
    canUndo: state.canUndo,
    canRedo: state.canRedo,
    canCopy: clipboard.canWrite && state.text !== "",
    hasMatches: find.matches.length > 0,
    monospace: state.prefs.monospace,
    caseSensitive: find.caseSensitive,
    actions: {
      newWindow: () => newWindow([]),
      open: () => setSheet({ kind: "open" }),
      close: requestClose,
      save: () => save(null),
      saveAs: () => setSheet({ kind: "save-as", after: null }),
      revert: () => model.revert(),
      undo: () => model.undo(),
      redo: () => model.redo(),
      paste: () => press("ctrl-v"),
      selectAll: () => press("ctrl-a"),
      copyAll: () => void clipboard.writeText(state.text),
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
          if (key === "Escape") setTextFocus((n) => n + 1);
          else model.findNext(key === "ArrowUp" ? -1 : 1);
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
            message="Type the path of the file to open. ~ is your home folder."
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
            title={sheet.after === "close" ? `Save “${name}”` : "Save As"}
            message="Type where to save it. ~ is your home folder."
            initial={suggestedSavePath(state.path, homedir(), existsSync(join(homedir(), "Documents")))}
            action="Save"
            onSubmit={(input) => submitSaveAs(input, sheet.after)}
            onCancel={closeSheet}
          />
        );
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
  const footer = (
    <View
      testID="footer"
      style={{
        height: 26,
        flexShrink: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 16,
        borderTopWidth: 1,
        borderColor: colors.separator,
      }}
    >
      <View style={{ flex: 1, minWidth: 0 }} onPress={state.notice ? () => model.dismissNotice() : undefined}>
        <Text numberOfLines={1} style={{ fontSize: 11, color: state.notice?.tone === "error" ? colors.critical : colors.textMuted }}>
          {state.notice?.text ?? stats}
        </Text>
      </View>
      {findStatus !== null && <Text style={{ fontSize: 11, color: colors.textMuted }}>{findStatus}</Text>}
      <Text style={{ fontSize: 11, color: colors.textMuted }}>{`${ENCODING_LABELS[state.encoding]} · ${LINE_ENDING_LABELS[state.lineEnding]}`}</Text>
    </View>
  );

  return (
    <AppWindow title={editedTitle(state.path, dirty)} subtitle={folderLabel(state.path) ?? undefined} toolbar={toolbar} overlay={overlay} footer={footer}>
      <TextArea
        text={state.text}
        prefs={state.prefs}
        session={state.session}
        focus={textFocus}
        onChange={(text) => model.edit(text)}
        onEscape={() => find.query !== "" && model.setQuery("")}
        scroll={scroll}
        reveal={state.reveal}
      />
    </AppWindow>
  );
}
