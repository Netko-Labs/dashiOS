/**
 * The Activity Monitor's body under the toolbar: the table of apps (each with
 * its processes under a disclosure) or of every process, and the summary strip
 * for the open tab. The list's keys are a view with no size: the arrows, ← and
 * → and Return act on the selected line, unless a sheet or a menu has them.
 */

import { EmptyState, glyphs, Table } from "@dashi/ui";
import { View } from "@mirinjs/metal";
import { fitColumns } from "./columns.ts";
import type { Line } from "./lines.ts";
import { Summary } from "./summary.tsx";
import type { MonitorModel } from "./use-monitor-window.ts";

/** The person's own top line with the most energy impact, for the summary's sentence. */
function heaviest(lines: readonly Line[]): Line | null {
  let top: Line | null = null;
  for (const line of lines) if (line.depth === 0 && line.own && line.impact > (top?.impact ?? 0)) top = line;
  return top;
}

export function MonitorContent({ model }: { model: MonitorModel }) {
  const { tab, state, view, query, size, keyboard, listing, sheets, keys } = model;
  return (
    <View style={{ flex: 1, flexDirection: "column", minHeight: 0 }}>
      {/* The list's keys: a view with no size, remounted to take the keyboard from the search field. A sheet's own keys come after it. */}
      <View
        key={`list:${keyboard.focus.list}`}
        testID="list-keys"
        style={{ position: "absolute", left: 0, top: 0, width: 0, height: 0 }}
        onWindowKeyDown={(event) => {
          if (sheets.blocked || event.ctrl || event.alt || event.meta) return;
          if (event.key === "up" || event.key === "down") keys.move(event.key);
          else if (event.key === "left" || event.key === "right") keys.expandWith(event.key);
          else if (event.key === "enter") sheets.inspect();
        }}
      />
      <Table
        testID="processes"
        // Short of room the name keeps its least width, and the figures it can spare go (columns.ts).
        columns={fitColumns(tab, listing.columns, size.width, listing.sort?.key ?? null)}
        rows={listing.lines}
        rowKey={(line) => line.key}
        // The list re-sorts every two seconds: rows hold still while the pointer is over them and just after a choice, so a click selects the line aimed at.
        steady
        selected={listing.selectedLine?.key ?? null}
        onSelect={keys.press}
        onContextMenu={keys.contextAt}
        sort={listing.sort}
        onSort={listing.sortBy}
        muted={(line) => !line.own}
        empty={
          state.rows.length === 0 ? (
            <EmptyState title="Reading processes…" />
          ) : (
            <EmptyState title="No matches" message={query ? `Nothing matches “${query.trim()}”.` : "Nothing in this view."} glyph={glyphs.SEARCH} />
          )
        }
      />
      {view.summary && <Summary tab={tab} state={state} totals={listing.totals} top={heaviest(listing.lines)} width={size.width} height={size.height} />}
    </View>
  );
}
