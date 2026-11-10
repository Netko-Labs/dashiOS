/** The sidebar's search field: a pill the color of an off tile, with the text input in it. */

import { Svg, TextInput, View } from "@mirinjs/metal";
import { useState } from "react";
import { useControlColors } from "../shared/controls/palette.ts";
import { SEARCH } from "../shared/settings/knob-glyphs.ts";
import { SIDEBAR } from "./sidebar-measures.ts";

export interface SearchProps {
  query: string;
  onQuery(query: string): void;
  onKey(key: "Escape" | "ArrowUp" | "ArrowDown"): void;
  onSubmit(): void;
  /** Bumped by ❖F: the field is made again, asking for the keyboard (find.ts `FindFocus`). */
  focusSerial: number;
}

/**
 * The field itself, made again by ❖F (keyed by `focusSerial`): it then asks
 * for the keyboard and selects what was typed, so new words replace it, as
 * on the Mac. The selection is taken once, when it is made.
 */
function SearchInput({ search }: { search: SearchProps }) {
  const colors = useControlColors();
  const [selected] = useState(() => (search.focusSerial > 0 ? { start: 0, end: search.query.length } : null));
  return (
    <TextInput
      testID="settings-search"
      value={search.query}
      placeholder="Search"
      {...(search.focusSerial > 0 ? { autoFocus: true } : {})}
      {...(selected ? { selection: selected } : {})}
      onChangeText={search.onQuery}
      onSubmitEditing={() => search.onSubmit()}
      onKeyPress={(key) => {
        // Esc empties the field first, as on the Mac; ↑ and ↓ move through what it found.
        if (key === "Escape" && search.query !== "") search.onQuery("");
        else search.onKey(key);
      }}
      style={{ flex: 1, height: 24, padding: 2, fontSize: 12.5, color: colors.text, placeholderColor: colors.muted, backgroundColor: "#00000000" }}
    />
  );
}

/** The search field: a 32-tall pill the color of an off tile. */
export function SearchPill({ search }: { search: SearchProps }) {
  const colors = useControlColors();
  return (
    <View
      style={{
        flex: 1,
        minWidth: 0,
        height: SIDEBAR.search,
        flexDirection: "row",
        alignItems: "center",
        gap: 7,
        paddingLeft: 10,
        paddingRight: 10,
        borderRadius: SIDEBAR.search / 2,
        backgroundColor: colors.off,
      }}
    >
      <Svg markup={SEARCH} size={15} color={colors.muted} />
      <SearchInput key={search.focusSerial} search={search} />
    </View>
  );
}
