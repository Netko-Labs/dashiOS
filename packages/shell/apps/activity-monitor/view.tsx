/**
 * Activity Monitor's window: one toolbar row (Quit…, the view button, the
 * CPU / Memory / Energy / Disk / Network tabs, search), the table of apps
 * (each with its processes under a disclosure) or of every process, and the
 * summary strip for the open tab, which View › Show Summary hides.
 *
 * The person's own apps and processes can be quit after a sheet asks;
 * everyone else's are shown dimmed and read-only. Nothing typed quits
 * anything: Return in the search selects, and the quit sheet has no Return
 * default. A quit app still running after a few seconds is offered a force
 * quit. The selection is a line's key (an app or a pid), not a place in the
 * list, and the rows hold still while the pointer is over them and just
 * after a line is chosen (the Table's `steady`). The list has the keyboard until the person clicks the search
 * field or presses ❖F, and takes it back when they click a row: there the
 * arrows move the selection, ← and → close and open an app, Return or a
 * double click inspects, and a right click offers the same commands. The
 * field's ↑ and ↓ move the selection too, and its Return selects and hands
 * the keyboard to the list. The battery menu
 * opens it at Energy with an app selected (args.ts, `onOpen`).
 */

import { AppWindow, EmptyState, glyphs, moveSelection, SearchField, Segmented, Table, ToolbarButton } from "@dashi/ui";
import { View } from "@mirinjs/metal";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useAppMenus } from "../kit/index.ts";
import type { OpenRequest } from "./args.ts";
import { COLUMNS, DEFAULT_SORT } from "./columns.ts";
import { buildLines, type Line, lineForApp, parentKey, submitSelection } from "./lines.ts";
import { monitorMenus, TABS, type ViewChoices } from "./menus.ts";
import type { Monitor, Tab } from "./monitor.ts";
import { NameCell } from "./name-cell.tsx";
import { STILL_RUNNING_MS } from "./policy.ts";
import { lineRefusal, type QuitActions, sendQuit } from "./quit.ts";
import { filterRows, scopeTotals } from "./sample.ts";
import { InspectSheet, QuitSheet, RefusedSheet, StillRunningSheet } from "./sheets.tsx";
import { Summary } from "./summary.tsx";
import { ContextMenu, ViewButton, ViewMenu } from "./view-menus.tsx";

export const MONITOR_SIZE = { width: 940, height: 640 } as const;

export interface MonitorActions extends QuitActions {
  copy(text: string): void;
  /** Hears what a second start asks for while the window is open (the kit's `onOpen`). */
  onOpen(listener: (request: OpenRequest) => void): void;
}

type SheetState =
  | { kind: "quit"; line: Line }
  | { kind: "refused"; name: string; reason: string }
  | { kind: "still"; line: Line }
  | { kind: "inspect"; line: Line }
  | null;

const DOUBLE_CLICK_MS = 450;

/** The person's own top line with the most energy impact, for the summary's sentence. */
function heaviest(lines: readonly Line[]): Line | null {
  let top: Line | null = null;
  for (const line of lines) if (line.depth === 0 && line.own && line.impact > (top?.impact ?? 0)) top = line;
  return top;
}

export function MonitorWindow({ monitor, actions, initial = {} }: { monitor: Monitor; actions: MonitorActions; initial?: OpenRequest }) {
  const state = useSyncExternalStore(monitor.subscribe, monitor.getSnapshot);
  const [tab, setTab] = useState<Tab>(initial.tab ?? "cpu");
  const [sorts, setSorts] = useState(DEFAULT_SORT);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<ViewChoices>({ grouped: true, mine: false, kernel: false, summary: true, interval: 2000 });
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [wanted, setWanted] = useState(initial.app ?? null);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [menu, setMenu] = useState<{ kind: "view" | "context"; x: number; y: number } | null>(null);
  // Who has the keyboard: the list (its key view, remounted to take it from the field) or the search field
  // (remounted with autoFocus). Each is bumped to hand it over, and again when a sheet closes.
  // (The person may have clicked into the field meanwhile, so the list's view is remounted on every click of a row.)
  const [keyboard, setKeyboard] = useState<{ owner: "list" | "field"; list: number; field: number }>({ owner: "list", list: 0, field: 0 });
  const toList = useCallback((): void => setKeyboard((now) => ({ ...now, owner: "list", list: now.list + 1 })), []);
  const toField = (): void => setKeyboard((now) => ({ ...now, owner: "field", field: now.field + 1 }));
  const giveBack = (): void => setKeyboard((now) => (now.owner === "list" ? { ...now, list: now.list + 1 } : { ...now, field: now.field + 1 }));
  const lastPress = useRef<{ key: string; at: number } | null>(null);
  const stillTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sort = sorts[tab];
  const toggle = useCallback((appKey: string): void => {
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(appKey)) next.add(appKey);
      return next;
    });
  }, []);
  const columns = useMemo(
    () =>
      COLUMNS[tab].map((column) =>
        column.key === "name"
          ? {
              ...column,
              cell: (line: Line, chosen: boolean) => (
                <NameCell
                  line={line}
                  selected={chosen}
                  onToggle={(each) => {
                    toggle(each.key.slice(4));
                    toList();
                  }}
                />
              ),
            }
          : column,
      ),
    [tab, toggle, toList],
  );
  const lines = useMemo(
    () => buildLines(filterRows(state.rows, query, view), { grouped: view.grouped, expanded, query, columns, sort }),
    [state.rows, query, view, expanded, columns, sort],
  );
  const selectedLine = lines.find((line) => line.key === selected) ?? null;
  const totals = useMemo(() => scopeTotals(state.rows, view), [state.rows, view]);
  const keys = lines.map((line) => line.key);

  useEffect(() => monitor.setKernel(view.kernel), [monitor, view.kernel]);
  useEffect(() => monitor.setInterval(view.interval), [monitor, view.interval]);
  useEffect(() => () => void (stillTimer.current && clearTimeout(stillTimer.current)), []);
  useEffect(() => {
    monitor.setTab(tab);
  }, [monitor, tab]);
  // The battery menu's app, selected once its line is there.
  useEffect(() => {
    if (!wanted) return;
    const found = lineForApp(lines, wanted);
    if (found) {
      setSelected(found);
      setWanted(null);
    }
  }, [lines, wanted]);
  useEffect(
    () =>
      actions.onOpen((request) => {
        if (request.tab) setTab(request.tab);
        if (request.app) {
          setQuery("");
          setView((current) => ({ ...current, grouped: true }));
          setWanted(request.app);
        }
      }),
    [actions],
  );

  const closeSheet = (): void => {
    setSheet(null);
    giveBack();
  };
  const quit = (line: Line | null = selectedLine): void => {
    if (!line) return;
    const reason = lineRefusal(line, state.rows, actions.guard);
    setSheet(reason ? { kind: "refused", name: line.name, reason } : { kind: "quit", line });
  };
  const answer = (line: Line, signal: "SIGTERM" | "SIGKILL" | null): void => {
    if (!signal) return closeSheet();
    const outcome = sendQuit(line, state.rows, signal, actions);
    if (outcome.kind === "refused") return setSheet({ kind: "refused", name: line.name, reason: outcome.reason });
    closeSheet();
    setTimeout(() => void monitor.refresh(), 300);
    if (outcome.kind !== "sent" || signal === "SIGKILL") return;
    if (stillTimer.current) clearTimeout(stillTimer.current);
    stillTimer.current = setTimeout(() => {
      stillTimer.current = null;
      if (outcome.targets.some((target) => actions.alive(target))) setSheet((open) => open ?? { kind: "still", line });
    }, STILL_RUNNING_MS);
  };
  const inspect = (line: Line | null = selectedLine): void => {
    if (line) setSheet({ kind: "inspect", line });
  };
  const copy = (line: Line | null = selectedLine): void => {
    if (line) actions.copy(columns.map((column) => column.text(line)).join("\t"));
  };
  const chooseTab = (next: Tab): void => setTab(next);
  const move = (direction: "up" | "down"): void => setSelected(moveSelection(keys, selectedLine?.key ?? null, direction));
  const press = (key: string): void => {
    const now = Date.now();
    const again = lastPress.current?.key === key && now - lastPress.current.at <= DOUBLE_CLICK_MS;
    lastPress.current = again ? null : { key, at: now };
    setSelected(key);
    toList();
    if (again) inspect(lines.find((line) => line.key === key) ?? null);
  };
  const blocked = sheet !== null || menu !== null;
  /** → opens the selected app, ← closes it; ← on one of its processes goes up to the app. */
  const expandWith = (key: "left" | "right"): void => {
    if (!selectedLine) return;
    if (selectedLine.expandable) {
      if (selectedLine.expanded !== (key === "right")) toggle(selectedLine.key.slice(4));
      return;
    }
    if (key === "left" && selectedLine.depth > 0) setSelected(parentKey(lines, selectedLine.key));
  };

  // The menu bar's menus (src/app-menus/).
  const { menus, run } = monitorMenus({
    tab,
    view,
    hasSelection: selectedLine !== null,
    blocked,
    actions: {
      find: toField,
      copy: () => copy(),
      setView: (patch) => setView({ ...view, ...patch }),
      chooseTab,
      inspect: () => inspect(),
      quitProcess: () => quit(),
    },
  });
  useAppMenus(menus, run);

  const refusal = selectedLine ? lineRefusal(selectedLine, state.rows, actions.guard) : null;
  const toolbar = (
    <>
      <ToolbarButton
        glyph={glyphs.STOP}
        label="Quit…"
        testID="stop"
        disabled={!selectedLine || refusal !== null}
        tooltip={selectedLine ? (refusal ?? `Quit ${selectedLine.name}`) : "Select an app to quit it"}
        onPress={() => quit()}
      />
      <ViewButton view={view} onOpen={(x, y) => setMenu({ kind: "view", x, y })} />
      <View style={{ width: 8 }} />
      <Segmented testID="tabs" options={TABS} value={tab} onChange={chooseTab} segmentWidth={64} />
      <View style={{ width: 8 }} />
      <SearchField
        key={`search:${keyboard.field}`}
        testID="search"
        value={query}
        onChangeText={setQuery}
        placeholder="Search processes"
        width={150}
        // Not under a sheet: it asks again when the sheet closes.
        autoFocus={keyboard.owner === "field" && sheet === null}
        onKeyPress={(key) => {
          if (key === "ArrowUp" || key === "ArrowDown") move(key === "ArrowUp" ? "up" : "down");
        }}
        // Return selects, and the list takes the keyboard: ← and → then open and close what was found.
        onSubmit={() => {
          setSelected(submitSelection(keys, selectedLine?.key ?? null));
          toList();
        }}
      />
    </>
  );

  const closeMenu = (): void => {
    setMenu(null);
    giveBack();
  };
  const overlay =
    sheet?.kind === "quit" ? (
      <QuitSheet line={sheet.line} onAnswer={(signal) => answer(sheet.line, signal)} />
    ) : sheet?.kind === "still" ? (
      <StillRunningSheet name={sheet.line.name} onAnswer={(force) => (force ? answer(sheet.line, "SIGKILL") : closeSheet())} />
    ) : sheet?.kind === "refused" ? (
      <RefusedSheet name={sheet.name} reason={sheet.reason} onClose={closeSheet} />
    ) : sheet?.kind === "inspect" ? (
      <InspectSheet
        // Its numbers go on with the list's while it is open.
        line={lines.find((line) => line.key === sheet.line.key) ?? sheet.line}
        parentName={state.rows.find((row) => row.pid === sheet.line.process?.ppid)?.name ?? null}
        onClose={closeSheet}
      />
    ) : menu?.kind === "view" ? (
      <ViewMenu x={menu.x} y={menu.y} view={view} onChange={(patch) => setView({ ...view, ...patch })} onClose={closeMenu} />
    ) : menu?.kind === "context" && selectedLine ? (
      <ContextMenu
        x={menu.x}
        y={menu.y}
        line={selectedLine}
        canQuit={refusal === null}
        onInspect={() => inspect()}
        onQuit={() => quit()}
        onToggle={() => toggle(selectedLine.key.slice(4))}
        onCopy={(text) => actions.copy(text)}
        onClose={closeMenu}
      />
    ) : undefined;

  return (
    // One chrome row: the scope is the view button's own label, and the summary is content under the table.
    <AppWindow title="Activity Monitor" toolbar={toolbar} overlay={overlay}>
      <View style={{ flex: 1, flexDirection: "column", minHeight: 0 }}>
        {/* The list's keys: a view with no size, remounted to take the keyboard from the search field. A sheet's own keys come after it. */}
        <View
          key={`list:${keyboard.list}`}
          testID="list-keys"
          style={{ position: "absolute", left: 0, top: 0, width: 0, height: 0 }}
          onWindowKeyDown={(event) => {
            if (blocked || event.ctrl || event.alt || event.meta) return;
            if (event.key === "up" || event.key === "down") move(event.key);
            else if (event.key === "left" || event.key === "right") expandWith(event.key);
            else if (event.key === "enter") inspect();
          }}
        />
        <Table
          testID="processes"
          columns={columns}
          rows={lines}
          rowKey={(line) => line.key}
          // The list re-sorts every two seconds: rows hold still while the pointer is over them and just after a choice, so a click selects the line aimed at.
          steady
          selected={selectedLine?.key ?? null}
          onSelect={press}
          onContextMenu={(key, point) => {
            setSelected(key);
            setMenu({ kind: "context", x: point.x, y: point.y });
          }}
          sort={sort}
          onSort={(next) => setSorts({ ...sorts, [tab]: next })}
          muted={(line) => !line.own}
          empty={
            state.rows.length === 0 ? (
              <EmptyState title="Reading processes…" />
            ) : (
              <EmptyState title="No matches" message={query ? `Nothing matches “${query.trim()}”.` : "Nothing in this view."} glyph={glyphs.SEARCH} />
            )
          }
        />
        {view.summary && <Summary tab={tab} state={state} totals={totals} top={heaviest(lines)} />}
      </View>
    </AppWindow>
  );
}
