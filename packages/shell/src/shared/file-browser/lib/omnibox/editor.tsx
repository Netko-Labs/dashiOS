/**
 * The omnibox while it is edited: text that starts like a path (`/`, `~`)
 * goes there, with its subfolders offered under it (↑↓ to pick, Enter to
 * go); anything else searches as you type, the results in the listing, in
 * this folder or everywhere (a two-way switch). Escape gives the crumbs back.
 */

import { SEARCH, SEARCH_FIELD, SearchField, Segmented, TYPE, useColors } from "@dashi/ui";
import { type Bounds, Text } from "@mirinjs/metal";
import { useEffect, useMemo, useState } from "react";
import { useFiles, useFilesState } from "../../context.ts";
import { sidebarGlyph } from "../../glyphs.ts";
import { completions, intentOf } from "../../omnibox.ts";
import type { OmniboxProps } from "../../omnibox-props.ts";

/** Tells the window what to list under the omnibox: the folders offered, the one lit, and what a pick does. */
function useSuggestions(
  onSuggest: OmniboxProps["onSuggest"],
  bounds: Bounds | null,
  offered: string[],
  highlighted: number,
  pick: (index: number) => void,
): void {
  // biome-ignore lint/correctness/useExhaustiveDependencies: `pick` and `onSuggest` are read when a pick happens; the list, the highlight, and the place are what change
  useEffect(() => {
    if (bounds === null || offered.length === 0) {
      onSuggest(null);
      return;
    }
    onSuggest({ bounds, items: offered, highlighted, pick });
  }, [bounds, offered, highlighted]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: clears the list once, when the editor goes
  useEffect(() => () => onSuggest(null), []);
}

/** Where a search looks: this folder or everywhere, and that it is still looking. */
function SearchScope() {
  const colors = useColors();
  const { store } = useFiles();
  const state = useFilesState();
  const here =
    state.location.kind === "folder" ? (state.location.path === store.env.home ? "Home" : (state.location.path.split("/").at(-1) ?? "")) : "This list";
  return (
    <>
      {state.searching && <Text style={{ fontSize: TYPE.caption.size, color: colors.textMuted }}>Searching…</Text>}
      <Segmented
        testID="omnibox:scope"
        options={[
          { value: "folder", label: here },
          { value: "computer", label: "Everywhere" },
        ]}
        value={state.scope}
        onChange={(scope) => store.setScope(scope)}
      />
    </>
  );
}

export function Editor({ editing, onDone, onSuggest }: OmniboxProps) {
  const { store, actions } = useFiles();
  const state = useFilesState();
  const [text, setText] = useState(editing ?? state.query);
  const [highlighted, setHighlighted] = useState(-1);
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const intent = intentOf(text);
  const offered = useMemo(() => (intent === "path" ? completions(text, store.env.home) : []), [intent, text, store.env.home]);

  const go = (target: string): void => {
    const problem = store.goToPath(target);
    if (problem !== null) {
      store.sayPathProblem(problem);
      return;
    }
    onDone();
  };
  const leave = (): void => {
    if (state.query !== "") store.setQuery("");
    onDone();
    actions.refocus();
  };

  useSuggestions(onSuggest, bounds, offered, highlighted, (index) => go(offered[index] ?? text));

  // The kit's search field, a find (Esc leaves at once): a folder glyph while a path is typed, where a search looks at its end.
  return (
    <SearchField
      testID="omnibox"
      width="fill"
      minWidth={SEARCH_FIELD.least}
      variant="find"
      value={text}
      glyph={intent === "path" ? sidebarGlyph("folder") : SEARCH}
      autoFocus={editing !== null}
      placeholder="Search, or type a path"
      onLayout={setBounds}
      accessory={intent === "search" && text.trim() !== "" ? <SearchScope /> : undefined}
      onClear={leave}
      onChangeText={(next) => {
        setText(next);
        setHighlighted(-1);
        if (intentOf(next) === "search") store.setQuery(next);
        else if (state.query !== "") store.setQuery("");
      }}
      onSubmit={(typed) => {
        if (intentOf(typed) === "path") go(highlighted >= 0 ? (offered[highlighted] ?? typed) : typed);
        else {
          onDone();
          actions.refocus();
        }
      }}
      onKeyPress={(key) => {
        if (key === "Escape") {
          // Whatever was half typed goes with it: the next edit starts from its own text.
          setText("");
          leave();
        } else if (intent === "path" && offered.length > 0) {
          const step = key === "ArrowDown" ? 1 : -1;
          setHighlighted((now) => Math.max(-1, Math.min(offered.length - 1, now + step)));
        } else if (key === "ArrowDown") {
          onDone();
          store.move("down");
          actions.refocus();
        }
      }}
    />
  );
}
