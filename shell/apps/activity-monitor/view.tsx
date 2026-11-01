/**
 * Activity Monitor's window: the toolbar (stop, the view menu, the CPU /
 * Memory / Disk / Network tabs, search), the process table, and the summary
 * strip for the open tab. The user's own processes can be quit (SIGTERM) or
 * force quit (SIGKILL) after a sheet asks; everyone else's are shown dimmed
 * and read-only. The search field holds the keyboard: typing filters, the
 * arrows move the selection, Esc clears. The menu bar's View menu has the
 * same choices as the toolbar's, the tabs, and Quit Process.
 */

import { Text, View } from "@mirinjs/metal";
import { useMemo, useState, useSyncExternalStore } from "react";
import {
  AppWindow,
  Button,
  EmptyState,
  glyphs,
  moveSelection,
  PopupMenu,
  SearchField,
  Segmented,
  Sheet,
  type SortState,
  sortRows,
  Table,
  ToolbarButton,
  useAppMenus,
  useColors,
} from "../kit/index.ts";
import { COLUMNS, DEFAULT_SORT } from "./columns.ts";
import { monitorMenus, TABS } from "./menus.ts";
import type { Monitor, Tab } from "./monitor.ts";
import { type QuitSignal, quitRefusal } from "./policy.ts";
import { filterRows, type ProcessRow } from "./sample.ts";
import { Summary } from "./summary.tsx";

export const MONITOR_SIZE = { width: 940, height: 640 } as const;

export interface MonitorActions {
  /** Sends `signal` to `pid`; what happened, for the sheet. */
  signal(pid: number, signal: QuitSignal): "sent" | "gone" | "denied";
  /** The shell, the compositor, the session: never quit from here. */
  protectedPids: ReadonlySet<number>;
}

type SheetState = { kind: "quit"; row: ProcessRow } | { kind: "refused"; row: ProcessRow; reason: string } | null;

function QuitSheet({ row, onAnswer }: { row: ProcessRow; onAnswer: (signal: QuitSignal | null) => void }) {
  const colors = useColors();
  return (
    <Sheet testID="quit-sheet" width={420} onCancel={() => onAnswer(null)} onConfirm={() => onAnswer("SIGTERM")}>
      <Text style={{ fontSize: 13, fontWeight: "bold", color: colors.text }}>{`Are you sure you want to quit “${row.name}”?`}</Text>
      <Text style={{ fontSize: 12, color: colors.textMuted, lineHeight: 16 }}>
        {`Quit asks it to close (SIGTERM to process ${row.pid}). Force Quit ends it at once (SIGKILL), and anything it has not saved is lost.`}
      </Text>
      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
        <Button label="Cancel" testID="quit-sheet:cancel" onPress={() => onAnswer(null)} />
        <Button label="Force Quit" testID="quit-sheet:force" danger onPress={() => onAnswer("SIGKILL")} />
        <Button label="Quit" testID="quit-sheet:quit" primary onPress={() => onAnswer("SIGTERM")} />
      </View>
    </Sheet>
  );
}

function RefusedSheet({ row, reason, onClose }: { row: ProcessRow; reason: string; onClose: () => void }) {
  const colors = useColors();
  return (
    <Sheet testID="refused-sheet" width={400} onCancel={onClose} onConfirm={onClose}>
      <Text style={{ fontSize: 13, fontWeight: "bold", color: colors.text }}>{`“${row.name}” can’t be quit from here.`}</Text>
      <Text style={{ fontSize: 12, color: colors.textMuted, lineHeight: 16 }}>{reason}</Text>
      <View style={{ flexDirection: "row", justifyContent: "flex-end", marginTop: 8 }}>
        <Button label="OK" testID="refused-sheet:ok" primary onPress={onClose} />
      </View>
    </Sheet>
  );
}

export function MonitorWindow({ monitor, actions }: { monitor: Monitor; actions: MonitorActions }) {
  const colors = useColors();
  const state = useSyncExternalStore(monitor.subscribe, monitor.getSnapshot);
  const [tab, setTab] = useState<Tab>("cpu");
  const [sorts, setSorts] = useState<Record<Tab, SortState>>(DEFAULT_SORT);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState({ mine: false, kernel: false });
  const [selected, setSelected] = useState<number | null>(null);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [viewMenu, setViewMenu] = useState<{ x: number; y: number } | null>(null);
  // Bumped when a sheet closes, so the search field takes the keyboard back.
  const [focus, setFocus] = useState(0);

  const columns = COLUMNS[tab];
  const sort = sorts[tab];
  const shown = useMemo(() => sortRows(filterRows(state.rows, query, scope), columns, sort), [state.rows, query, scope, columns, sort]);
  const selectedRow = shown.find((row) => row.pid === selected) ?? null;

  const chooseTab = (next: Tab): void => {
    setTab(next);
    monitor.setTab(next);
  };
  const closeSheet = (): void => {
    setSheet(null);
    setFocus((n) => n + 1);
  };
  const stop = (): void => {
    if (!selectedRow) return;
    const reason = quitRefusal(selectedRow, actions.protectedPids);
    setSheet(reason ? { kind: "refused", row: selectedRow, reason } : { kind: "quit", row: selectedRow });
  };
  const answer = (row: ProcessRow, signal: QuitSignal | null): void => {
    if (!signal) return closeSheet();
    // Asked again at the moment of sending: the row may be stale by a refresh.
    const reason = quitRefusal(row, actions.protectedPids);
    const outcome = reason ? "denied" : actions.signal(row.pid, signal);
    if (outcome === "denied") {
      setSheet({ kind: "refused", row, reason: reason ?? "The system refused the signal (permission denied)." });
      return;
    }
    closeSheet();
    setTimeout(() => monitor.refresh(), 300);
  };

  const scopeLabel = scope.mine ? "My Processes" : "All Processes";

  // The menu bar's menus (src/app-menus/), as on a Mac.
  const { menus, run } = monitorMenus({
    tab,
    scope,
    hasSelection: selectedRow !== null,
    blocked: sheet !== null || viewMenu !== null,
    actions: {
      find: () => setFocus((n) => n + 1),
      setScope: (patch) => setScope({ ...scope, ...patch }),
      toggleKernel: () => setScope({ ...scope, kernel: !scope.kernel }),
      chooseTab,
      quitProcess: stop,
    },
  });
  useAppMenus(menus, run);
  const toolbar = (
    <>
      <ToolbarButton glyph={glyphs.STOP} testID="stop" disabled={!selectedRow} onPress={stop} />
      <View
        testID="view-menu"
        onPress={(event) => setViewMenu({ x: Math.max((event.bounds?.x ?? 0) - 40, 8), y: (event.bounds?.y ?? 0) + (event.bounds?.height ?? 28) + 4 })}
        style={{ height: 28, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, borderRadius: 7, hoverBackgroundColor: colors.button }}
      >
        <Text style={{ fontSize: 12, color: colors.text }}>{scopeLabel}</Text>
        <Text style={{ fontSize: 9, color: colors.textMuted }}>▼</Text>
      </View>
      <View style={{ width: 8 }} />
      <Segmented testID="tabs" options={TABS} value={tab} onChange={chooseTab} segmentWidth={74} />
      <View style={{ width: 8 }} />
      <SearchField
        key={focus}
        testID="search"
        value={query}
        onChangeText={setQuery}
        width={190}
        autoFocus
        onKeyPress={(key) => {
          if (key === "ArrowUp" || key === "ArrowDown") {
            setSelected(moveSelection(shown.map((row) => row.pid), selectedRow?.pid ?? null, key === "ArrowUp" ? "up" : "down"));
          }
        }}
        onSubmit={() => stop()}
      />
    </>
  );

  const overlay =
    sheet?.kind === "quit" ? (
      <QuitSheet row={sheet.row} onAnswer={(signal) => answer(sheet.row, signal)} />
    ) : sheet?.kind === "refused" ? (
      <RefusedSheet row={sheet.row} reason={sheet.reason} onClose={closeSheet} />
    ) : viewMenu ? (
      <PopupMenu
        testID="view-menu-items"
        x={viewMenu.x}
        y={viewMenu.y}
        onClose={() => {
          setViewMenu(null);
          setFocus((n) => n + 1);
        }}
        items={[
          { label: "All Processes", checked: !scope.mine, onPress: () => setScope({ ...scope, mine: false }) },
          { label: "My Processes", checked: scope.mine, onPress: () => setScope({ ...scope, mine: true }) },
          { label: "Kernel Threads", checked: scope.kernel, onPress: () => setScope({ ...scope, kernel: !scope.kernel }) },
        ]}
      />
    ) : undefined;

  return (
    <AppWindow title="Activity Monitor" subtitle={scopeLabel} toolbar={toolbar} overlay={overlay} footer={<Summary tab={tab} state={state} processes={state.rows.filter((row) => !row.kernel).length} />}>
      <Table
        testID="processes"
        columns={columns}
        rows={shown}
        rowKey={(row) => row.pid}
        selected={selectedRow?.pid ?? null}
        onSelect={setSelected}
        sort={sort}
        onSort={(next) => setSorts({ ...sorts, [tab]: next })}
        muted={(row) => !row.own}
        empty={
          state.rows.length === 0 ? (
            <EmptyState title="Reading processes…" />
          ) : (
            <EmptyState title="No Results" message={query ? `No process matches “${query.trim()}”.` : "No process in this view."} glyph={glyphs.SEARCH} />
          )
        }
      />
    </AppWindow>
  );
}
