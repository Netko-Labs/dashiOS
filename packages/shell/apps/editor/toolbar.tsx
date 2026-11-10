/**
 * The editor's toolbar: New, Open, Save, and the Find field with Find's
 * place in it ("2 of 4"). It shares the row with the title.
 */

import { SearchField, ToolbarButton } from "@dashi/ui";
import { View } from "@mirinjs/metal";
import { NEW, OPEN, SAVE } from "./glyphs.ts";
import type { EditorModel, EditorState } from "./model.ts";
import { findPlace } from "./status.ts";
import type { EditorSheets } from "./use-editor-sheets.ts";

/** Find's field: as wide as this with room, never narrower than FIND_MIN. */
const FIND_WIDTH = 200;
const FIND_MIN = 120;

export function EditorToolbar({
  model,
  state,
  sheets,
  newWindow,
  findFocus,
  jump,
  focusText,
}: {
  model: EditorModel;
  state: EditorState;
  sheets: EditorSheets;
  newWindow: (files: readonly string[]) => void;
  /** Bumped to give the keyboard to the Find field (it is mounted again). */
  findFocus: number;
  jump: (step: 1 | -1) => void;
  focusText: () => void;
}) {
  const { find } = state;
  return (
    <>
      <ToolbarButton testID="new" glyph={NEW} tooltip="New document" onPress={() => newWindow([])} />
      <ToolbarButton testID="open" glyph={OPEN} tooltip="Open" onPress={() => sheets.setSheet({ kind: "open" })} />
      <ToolbarButton testID="save" glyph={SAVE} tooltip={state.path === null ? "Save" : "Save a version"} disabled={model.isPristine} onPress={sheets.save} />
      {/* Find shares the row with the title: from FIND_MIN, growing to FIND_WIDTH as the row allows. */}
      <View testID="find-box" style={{ flex: 1, minWidth: FIND_MIN, maxWidth: FIND_WIDTH, flexDirection: "row" }}>
        <SearchField
          key={`find:${findFocus}`}
          testID="find"
          placeholder="Find"
          value={find.query}
          status={findPlace(find)}
          width={FIND_WIDTH}
          minWidth={FIND_MIN}
          autoFocus={findFocus > 0}
          onChangeText={(query) => model.setQuery(query)}
          onSubmit={() => jump(1)}
          // One Esc leaves Find: the query stays (❖G goes on), the text takes the keyboard on the current match.
          variant="find"
          onKeyPress={(key) => {
            if (key !== "Escape") return jump(key === "ArrowUp" ? -1 : 1);
            if (find.current < 0) jump(1);
            focusText();
          }}
        />
      </View>
    </>
  );
}
