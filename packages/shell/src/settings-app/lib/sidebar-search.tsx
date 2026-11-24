/** The sidebar's search field: the kit's search field in the panel look, as wide as its row (SE-A11, UI-11). */

import { SearchField } from "@dashi/ui";

export interface SearchProps {
  query: string;
  onQuery(query: string): void;
  onKey(key: "Escape" | "ArrowUp" | "ArrowDown"): void;
  onSubmit(): void;
  /** Bumped by ❖F: the field is made again, asking for the keyboard (find.ts `FindFocus`). */
  focusSerial: number;
}

/**
 * The field, made again by ❖F (keyed by `focusSerial`): it then asks for the
 * keyboard and selects what was typed, so new words replace it, as on the
 * Mac. Esc empties it first; ↑ and ↓ move through what it found.
 */
export function SidebarSearch({ search }: { search: SearchProps }) {
  const again = search.focusSerial > 0;
  return (
    <SearchField
      key={search.focusSerial}
      look="panel"
      width="fill"
      testID="settings-search"
      value={search.query}
      onChangeText={search.onQuery}
      onSubmit={() => search.onSubmit()}
      onKeyPress={search.onKey}
      {...(again ? { autoFocus: true, selectAll: true } : {})}
    />
  );
}
