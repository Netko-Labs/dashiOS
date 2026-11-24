/**
 * The Store's one toolbar row, after the window's name: the queue's activity
 * (a chip that opens what runs), the "saved results" chip when a search is
 * stale, Check for updates on Updates, Catalogs… on Menu bar applets, and the
 * search field. Compact (a narrow page) it shortens the labels and drops the
 * window's name (toolbar-fit.ts).
 */

import { SEARCH_FIELD, SearchField, ToolbarButton } from "@dashi/ui";
import type { Dispatch, SetStateAction } from "react";
import { APPLETS, REFRESH, SOURCES } from "./glyphs.ts";
import { queueLine } from "./model.ts";
import { type Nav, type Page, search } from "./nav.ts";
import type { Actions } from "./parts.tsx";
import { Activity, StaleNote } from "./states.tsx";
import type { SoftwareState } from "./store.ts";
import { CHIP_MAX_WIDTH } from "./toolbar-fit.ts";

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
  openSources(): void;
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
  openSources,
  onCheckUpdates,
}: SoftwareToolbarProps) {
  const activity = queueLine(operations, { short: compact });
  const running = operations.find((operation) => operation.status === "running");
  return (
    <>
      {stale > 0 && <StaleNote short={compact} />}
      {activity !== null && (
        <Activity
          testID="activity"
          text={activity}
          maxWidth={CHIP_MAX_WIDTH}
          onPress={() =>
            running?.id === undefined || (running.subject !== undefined && running.subject !== "applet")
              ? go({ kind: "updates" })
              : actions[running.subject === "applet" ? "openApplet" : "openApp"](running.id)
          }
        />
      )}
      {nav.page.kind === "updates" && (
        <ToolbarButton
          testID="check-updates"
          glyph={REFRESH}
          {...(compact ? { tooltip: "Check for updates" } : { label: checking ? "Checking…" : "Check for updates" })}
          disabled={checking}
          onPress={onCheckUpdates}
        />
      )}
      {nav.page.kind === "applets" && (
        <ToolbarButton testID="catalogs" glyph={APPLETS} {...(compact ? { tooltip: "Catalogs…" } : { label: "Catalogs…" })} onPress={openCatalogs} />
      )}
      {(nav.page.kind === "installed" || nav.page.kind === "apps") && (
        <ToolbarButton testID="sources" glyph={SOURCES} {...(compact ? { tooltip: "Sources…" } : { label: "Sources…" })} onPress={openSources} />
      )}
      <SearchField
        key={focus}
        testID="search"
        value={query}
        onChangeText={setQuery}
        // The kit shortens a placeholder to "Search" as the field shrinks (UI-11).
        placeholder={filtering ? "Search installed" : "Search apps and add-ons"}
        width={SEARCH_FIELD.width}
        minWidth={SEARCH_FIELD.least}
        autoFocus
        onSubmit={(text) => !filtering && setNav((now) => search(now, text))}
      />
    </>
  );
}
