/**
 * Settings' header strip, the window's one chrome row (VS-1): the pane's
 * title (13 Bold, design.html "Unified toolbar"), then at the right
 * Recently changed's button and the search field, over a hairline as every
 * app's toolbar has. The strip is also where the window is grabbed.
 */

import { SearchField, ToolbarButton, useColors } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { HISTORY } from "./glyphs.ts";

/** The header strip's measures: as tall as the window controls' row, the search field this wide. */
export const HEADER = { height: 38, searchWidth: 180 } as const;

export interface SearchProps {
  query: string;
  onQuery(query: string): void;
  onKey(key: "Escape" | "ArrowUp" | "ArrowDown"): void;
  onSubmit(): void;
  /** Bumped by ❖F: the field is made again, asking for the keyboard (find.ts `FindFocus`). */
  focusSerial: number;
}

export function HeaderStrip({ title, height, onRecent, search }: { title: string; height: number; onRecent: () => void; search: SearchProps }) {
  const colors = useColors();
  return (
    <View
      testID="settings-toolbar"
      dragRegion
      style={{
        height,
        flexShrink: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingLeft: 24,
        paddingRight: 12,
        // The hairline every app's toolbar has: scrolled rows pass under an edge, not an invisible line.
        borderBottomWidth: 1,
        borderColor: colors.separator,
      }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: "bold", color: colors.text }}>
          {title}
        </Text>
      </View>
      <ToolbarButton testID="settings-recent" glyph={HISTORY} tooltip="Recently changed" onPress={onRecent} />
      <SearchField
        key={search.focusSerial}
        testID="settings-search"
        placeholder="Search"
        width={HEADER.searchWidth}
        value={search.query}
        onChangeText={search.onQuery}
        onKeyPress={search.onKey}
        onSubmit={() => search.onSubmit()}
        {...(search.focusSerial > 0 ? { autoFocus: true } : {})}
      />
    </View>
  );
}
