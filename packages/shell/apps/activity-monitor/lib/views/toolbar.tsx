/**
 * The toolbar's controls as `toolbar-fit.ts` lays them out for the window's
 * width: Quit… (or its glyph), the view button (or its glyph), the five tabs,
 * and search. In a narrow window search is a glyph; pressing it (or ❖F) puts
 * the field in the tabs' place until it is left empty, so a query that is
 * still filtering the list always shows.
 */

import { glyphs, SearchField, Segmented, ToolbarButton } from "@dashi/ui";
import type { MonitorModel } from "../hooks/use-monitor-window.ts";
import { submitSelection } from "../lines.ts";
import type { ViewChoices } from "../menus.ts";
import { TABS } from "../menus.ts";
import type { Tab } from "../monitor.ts";
import { TOOLBAR, type ToolbarFit, tabsWidth } from "../toolbar-fit.ts";
import { ViewButton } from "./view-menus.tsx";

export interface MonitorToolbarProps {
  fit: ToolbarFit;
  tab: Tab;
  onTab: (tab: Tab) => void;
  view: ViewChoices;
  onViewMenu: (x: number, y: number) => void;
  /** What Quit… would quit, and why it can't (its tooltip); null with nothing selected. */
  quit: { name: string; refusal: string | null } | null;
  onQuit: () => void;
  search: {
    /** Remounts the field to give it the keyboard. */
    key: number;
    value: string;
    onChange: (text: string) => void;
    /** The field has the keyboard (it asks for it as it mounts). */
    focused: boolean;
    /** Hand it the keyboard (the glyph, ❖F). */
    onOpen: () => void;
    onArrow: (direction: "up" | "down") => void;
    /** Esc in an empty field: the list takes the keyboard back. */
    onLeave: () => void;
    onSubmit: () => void;
  };
}

/** The toolbar as the window's model wires it: the tabs, the view button, Quit… and the search. */
export function MonitorBar({ model }: { model: MonitorModel }) {
  const { fit, tab, chooseTab, view, query, setQuery, sheets, listing, keyboard, keys } = model;
  const { selectedLine } = listing;
  return (
    <MonitorToolbar
      fit={fit}
      tab={tab}
      onTab={chooseTab}
      view={view}
      onViewMenu={(x, y) => sheets.setMenu({ kind: "view", x, y })}
      quit={selectedLine ? { name: selectedLine.name, refusal: sheets.refusal } : null}
      onQuit={() => sheets.quit()}
      search={{
        key: keyboard.focus.field,
        value: query,
        onChange: setQuery,
        // Not under a sheet: it asks again when the sheet closes.
        focused: keyboard.focus.owner === "field" && sheets.sheet === null,
        onOpen: keyboard.toField,
        onArrow: keys.move,
        onLeave: keyboard.toList,
        onSubmit: () => {
          listing.setSelected(submitSelection(listing.keys, selectedLine?.key ?? null));
          keyboard.toList();
        },
      }}
    />
  );
}

export function MonitorToolbar({ fit, tab, onTab, view, onViewMenu, quit, onQuit, search }: MonitorToolbarProps) {
  // A narrow window's field stands in the tabs' place while it has the keyboard or still filters.
  const fieldOverTabs = !fit.searchField && (search.focused || search.value !== "");
  const field = (width: number) => (
    <SearchField
      key={`search:${search.key}`}
      testID="search"
      value={search.value}
      onChangeText={search.onChange}
      placeholder="Search processes"
      width={width}
      autoFocus={search.focused}
      onKeyPress={(key) => {
        if (key === "ArrowUp" || key === "ArrowDown") search.onArrow(key === "ArrowUp" ? "up" : "down");
        else if (key === "Escape") search.onLeave();
      }}
      // Return selects, and the list takes the keyboard: ← and → then open and close what was found.
      onSubmit={search.onSubmit}
    />
  );
  return (
    <>
      <ToolbarButton
        glyph={glyphs.STOP}
        {...(fit.quitLabel ? { label: "Quit…" } : {})}
        testID="stop"
        disabled={quit === null || quit.refusal !== null}
        tooltip={quit ? (quit.refusal ?? `Quit ${quit.name}`) : "Select an app to quit it"}
        onPress={onQuit}
      />
      <ViewButton view={view} compact={!fit.viewLabel} onOpen={onViewMenu} />
      {fieldOverTabs ? (
        // The tabs' slot and the glyph's, so nothing beside them moves.
        field(tabsWidth(fit.segment) + TOOLBAR.gap + TOOLBAR.icon)
      ) : (
        <>
          <Segmented testID="tabs" options={TABS} value={tab} onChange={onTab} segmentWidth={fit.segment} />
          {fit.searchField ? (
            field(TOOLBAR.search)
          ) : (
            <ToolbarButton glyph={glyphs.SEARCH} testID="search-open" tooltip="Search processes" onPress={search.onOpen} />
          )}
        </>
      )}
    </>
  );
}
