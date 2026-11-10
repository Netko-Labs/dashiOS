/**
 * The sheet over the editor, if one is up: Files' chooser for Open and Save
 * As, the saved versions, the conflict with the file on disk, the draft's
 * deletion, Go to Line and Replace.
 */

import { ConfirmSheet } from "@dashi/ui";
import type { ReactElement } from "react";
import type { EditorModel } from "../model.ts";
import type { EditorState } from "../state.ts";
import type { EditorSheets } from "../use-editor-sheets.ts";
import { versionDifference } from "../versions.ts";
import { EditorChooser } from "./chooser.tsx";
import { ConflictSheet, GoToLineSheet, ReplaceSheet, VersionsSheet } from "./sheets.tsx";

export function editorOverlay({
  model,
  state,
  name,
  lines,
  sheets,
  goToLine,
  quit,
}: {
  model: EditorModel;
  state: EditorState;
  name: string;
  lines: number;
  sheets: EditorSheets;
  goToLine: (line: number) => void;
  quit: (discard: boolean) => void;
}): ReactElement | null | undefined {
  const { sheet, chooser, closeSheet } = sheets;
  if (!sheet) return undefined;
  switch (sheet.kind) {
    case "open":
      return chooser && <EditorChooser request={chooser} answer={(paths) => (paths?.[0] ? sheets.chooseOpen(paths[0]) : closeSheet())} />;
    case "save-as":
      return chooser && <EditorChooser request={chooser} answer={(paths) => (paths?.[0] ? sheets.chooseSaveAs(paths[0]) : closeSheet())} />;
    case "versions":
      return (
        <VersionsSheet
          name={name}
          versions={model.listVersions()}
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
            sheets.afterConflict();
          }}
          onUseDisk={() => {
            model.revert("Use the One on Disk");
            sheets.afterConflict();
          }}
          onSaveAs={() => sheets.setSheet({ kind: "save-as" })}
          onCancel={() => {
            sheets.closing.current = false;
            closeSheet();
          }}
        />
      ) : undefined;
    case "delete-draft":
      return (
        <ConfirmSheet
          testID="delete-draft"
          title={`Delete the draft “${name}”?`}
          // Two sentences, two lines: broken by hand, so no word is left alone on the second.
          message={"The window closes and its text is gone.\nYou can't undo this."}
          confirmLabel="Delete"
          danger
          onConfirm={() => quit(true)}
          onCancel={closeSheet}
        />
      );
    case "go-to-line":
      return (
        <GoToLineSheet
          lines={lines}
          onGo={(line) => {
            goToLine(line);
            closeSheet();
          }}
          onCancel={closeSheet}
        />
      );
    case "replace":
      return (
        <ReplaceSheet
          query={state.find.query}
          matches={state.find.matches.length}
          onQuery={(query) => model.setQuery(query)}
          onReplaceAll={(replacement) => model.replaceAll(replacement)}
          onCancel={closeSheet}
        />
      );
  }
}
