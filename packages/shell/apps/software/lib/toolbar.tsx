/**
 * Software's one toolbar row, after the window's name: the queue's activity
 * (a chip that opens what runs), the "saved results" chip when a search is
 * stale, Check for Updates on Updates, Catalogs… on Menu bar applets, and the
 * search field. Compact (a narrow page) it shortens the labels and drops the
 * window's name (toolbar-fit.ts).
 */

import { SearchField, ToolbarButton } from "@dashi/ui";
import type { Dispatch, SetStateAction } from "react";
import { APPLETS, REFRESH } from "./glyphs.ts";
import { queueLine } from "./model.ts";
import { type Nav, type Page, search } from "./nav.ts";
import type { Actions } from "./parts.tsx";
import { StaleChip, ToolbarChip } from "./states.tsx";
import type { SoftwareState } from "./store.ts";
import { CHIP_MAX_WIDTH, SEARCH_MIN_WIDTH, SEARCH_WIDTH } from "./toolbar-fit.ts";

export interface SoftwareToolbarProps {
  nav: Nav;
  setNav: Dispatch<SetStateAction<Nav>>;
  query: string;
  setQuery: Dispatch<SetStateAction<string>>;
  filtering: boolean;
  compact: boolean;
  /** Searches showing older results: the stale chip. */
  stale: number;
  operations: SoftwareState["operations"];
  checking: boolean;
  /** Bumped to put the keyboard back in the search field. */
  focus: number;
  go(page: Page): void;
  actions: Pick<Actions, "openApp" | "openApplet">;
  openCatalogs(): void;
  onCheckUpdates(): void;
}

export function SoftwareToolbar({
  nav,
  setNav,
  query,
  setQuery,
  filtering,
  compact,
  stale,
  operations,
  checking,
  focus,
  go,
  actions,
  openCatalogs,
  onCheckUpdates,
}: SoftwareToolbarProps) {
  const activity = queueLine(operations, { short: compact });
  const running = operations.find((operation) => operation.status === "running");
  return (
    <>
      {stale > 0 && <StaleChip short={compact} />}
      {activity !== null && (
        <ToolbarChip
          testID="activity"
          text={activity}
          maxWidth={CHIP_MAX_WIDTH}
          onPress={() => (running?.id === undefined ? go({ kind: "updates" }) : actions[running.subject === "applet" ? "openApplet" : "openApp"](running.id))}
        />
      )}
      {nav.page.kind === "updates" && (
        <ToolbarButton
          testID="check-updates"
          glyph={REFRESH}
          {...(compact ? { tooltip: "Check for Updates" } : { label: checking ? "Checking…" : "Check for Updates" })}
          disabled={checking}
          onPress={onCheckUpdates}
        />
      )}
      {nav.page.kind === "applets" && (
        <ToolbarButton testID="catalogs" glyph={APPLETS} {...(compact ? { tooltip: "Catalogs…" } : { label: "Catalogs…" })} onPress={openCatalogs} />
      )}
      <SearchField
        key={focus}
        testID="search"
        value={query}
        onChangeText={setQuery}
        placeholder={compact ? "Search" : filtering ? "Search installed" : "Search apps and applets"}
        width={SEARCH_WIDTH}
        minWidth={SEARCH_MIN_WIDTH}
        autoFocus
        onSubmit={(text) => !filtering && setNav((now) => search(now, text))}
      />
    </>
  );
}
