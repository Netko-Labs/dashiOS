/**
 * The Terminal's window: one chrome row (VS-1), the unified title bar with
 * the front tab's name, or the tabs themselves once there are two (VS-4,
 * tab-strip.tsx), and a + for a new tab; then the front tab's grid
 * (grid.tsx), in Dashi's terminal colors (palette.ts) or the ones a program
 * set. Each tab is its own dashi-term (sessions.ts) with the shell
 * integration, so tabs are named by folder and command (naming.ts), new
 * tabs and windows open where the front tab is, ❖↑ ❖↓ jump between
 * prompts and failed commands are marked in the margin. The grid takes the
 * keyboard raw and sends every key to the engine, which encodes it the way
 * the program asked (libghostty-vt); ⇧PgUp and ⇧PgDn page through the
 * scrollback. Closing a tab or the window while a program runs in it asks
 * first (closing.ts), however the window is closed (a close request, kit/close.ts).
 */

import { hostname } from "node:os";
import { AppWindow, ConfirmSheet, EmptyState, MENU_SEPARATOR, PopupMenu, ToolbarButton, useDark } from "@dashi/ui";
import { type Bounds, type KeyDownInfo, Text, View } from "@mirinjs/metal";
import { useEffect, useRef, useState } from "react";
import { type Clipboard, type CloseReason, useAppMenus, useCloseRequest, useCloseWithdrawn } from "../kit/index.ts";
import { type CloseQuestion, closeCopy, stillRunning } from "./closing.ts";
import { GRID_TOP, Grid, MARGIN } from "./grid.tsx";
import { type Cell, FONT_SIZE, lineHeightFor, stepFontSize } from "./line.tsx";
import { terminalMenus } from "./menus.ts";
import { localFolder, tabName } from "./naming.ts";
import { terminalPalette } from "./palette.ts";
import { gridFor } from "./screen.ts";
import { colorsMessage, useSessions } from "./sessions.ts";
import { useScreenPart } from "./store.ts";
import { TabStrip } from "./tab-strip.tsx";
import { activeTab, NO_TABS, selectTab, showIndex, stepTab, type Tabs } from "./tabs.ts";

export const TERMINAL_SIZE = { width: 760, height: 480 } as const;
const PROBE = "M".repeat(10);
const PLUS = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M8 3.5v9M3.5 8h9" stroke="#000" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>`;

export interface TerminalWindowProps {
  /** dashi-term, or null when it isn't installed: the window says so. */
  binary: string | null;
  onExit(): void;
  /** Another window, its first shell in `folder` (home when null). */
  newWindow(folder: string | null): void;
  /** Retitle the window (the Dock, the switcher, the window list). */
  setTitle(title: string): void;
  /** Made once, by main.tsx: finding wl-copy is not a render's work. */
  clipboard: Clipboard;
  /** Where the first tab's shell starts (a window opened from another); home when null. */
  firstFolder?: string | null;
  /** What the first tab runs in place of the shell (`… -- htop`: an app whose desktop entry says `Terminal=true`). */
  firstCommand?: readonly string[] | null;
}

export function TerminalWindow(props: TerminalWindowProps) {
  if (props.binary === null) {
    return (
      <AppWindow title="Terminal">
        <EmptyState title="Terminal can't start" message="Its engine, dashi-term, isn't installed. Install the dashi-term package." />
      </AppWindow>
    );
  }
  return <Terminal {...props} binary={props.binary} />;
}

function Terminal({
  binary,
  onExit,
  newWindow,
  setTitle: setWindowTitle,
  clipboard,
  firstFolder = null,
  firstCommand = null,
}: TerminalWindowProps & { binary: string }) {
  const dark = useDark();
  const palette = terminalPalette(dark);
  const home = process.env.HOME;
  const [tabs, setTabsState] = useState<Tabs>(NO_TABS);
  const tabsNow = useRef(tabs);
  tabsNow.current = tabs;
  const setTabs = (change: (tabs: Tabs) => Tabs): void => setTabsState(change);
  const [fontSize, setFontSize] = useState(FONT_SIZE);
  const [cell, setCell] = useState<Cell | null>(null);
  const [bells, setBells] = useState(0);
  /** Closing something that still runs a program: the question on screen. */
  const [asking, setAsking] = useState<CloseQuestion | null>(null);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  /** Bumped when a sheet goes, so the grid (mounted again) takes the keyboard back. */
  const [gridFocus, setGridFocus] = useState(0);
  const bounds = useRef<Bounds | null>(null);
  const paletteNow = useRef(palette);
  paletteNow.current = palette;
  const sessions = useSessions({
    binary,
    clipboard,
    palette: () => paletteNow.current,
    setTabs,
    tabs: () => tabsNow.current,
    onFrontBell: () => setBells((n) => n + 1),
  });

  const front = activeTab(tabs);
  const engine = () => (front ? sessions.engine(front.id) : undefined);
  /** Where a new tab or window opens: the front tab's folder, on this machine. */
  const here = (): string | null => localFolder(front?.naming.folder, hostname());
  const selected = useScreenPart(sessions.store, front?.id ?? -1, (screen) => screen.selected);

  /** A tab's ×, ❖W: at once at the prompt, else after asking. */
  const requestCloseTab = (id: number): void => {
    const each = sessions.engine(id);
    if (!each) {
      sessions.close(id);
      return;
    }
    void each.running().then((program) => {
      if (program === null) sessions.close(id);
      else setAsking({ kind: "tab", id, program });
    });
  };

  /** ⇧❖W, Close Window: at once when every tab is at its prompt, else after asking. */
  const requestCloseWindow = (reason: CloseReason = "close"): void => {
    void Promise.all(sessions.engines().map((each) => each.running())).then((answers) => {
      const programs = stillRunning(answers);
      if (programs.length === 0) onExit();
      else setAsking({ kind: "window", programs, ...(reason === "quit" ? { quit: true } : {}) });
    });
  };
  // The close control, ❖Q, the Dock's Quit, logging out: as Close Window, asking "Quit Terminal?" when it quits.
  useCloseRequest(requestCloseWindow);
  // The log out that asked was cancelled: "Quit Terminal?" goes with it (a tab's own question stays).
  useCloseWithdrawn(() => {
    if (asking?.kind !== "window") return;
    setAsking(null);
    refocus();
  });

  const refocus = (): void => setGridFocus((n) => n + 1);

  // Every tab follows the window's grid; the first starts once the cell is measured.
  const fit = (): void => {
    const area = bounds.current;
    if (!cell || !area) return;
    const { cols, rows } = gridFor(area.width, area.height, cell.width, cell.height);
    const cw = Math.round(cell.width);
    const ch = Math.round(cell.height);
    const was = sessions.size.current;
    if (was?.cols === cols && was.rows === rows && was.cw === cw && was.ch === ch) return;
    sessions.size.current = { cols, rows, cw, ch };
    sessions.broadcast({ t: "resize", cols, rows, cw, ch });
    if (!sessions.started()) sessions.open(firstFolder, firstCommand);
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: fit reads refs; it runs when the cell is measured again.
  useEffect(fit, [cell]);
  // Dark Mode changes every tab's colors; programs' own stay theirs.
  // biome-ignore lint/correctness/useExhaustiveDependencies: sessions is a facade over refs.
  useEffect(() => {
    sessions.broadcast(colorsMessage(palette));
  }, [palette]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: on unmount only.
  useEffect(
    () => () => {
      for (const each of sessions.engines()) each.stop();
    },
    [],
  );
  // The last tab closing (its shell exited, or ❖W) closes the window.
  // biome-ignore lint/correctness/useExhaustiveDependencies: sessions is a facade over refs.
  useEffect(() => {
    if (sessions.started() && tabs.list.length === 0) onExit();
  }, [tabs, onExit]);

  const names = tabs.list.map((tab) => tabName(tab.naming, home));
  const windowTitle = front ? tabName(front.naming, home) : "Terminal";
  useEffect(() => {
    setWindowTitle(windowTitle);
  }, [windowTitle, setWindowTitle]);

  const actions = {
    copy: () => engine()?.send({ t: "copy" }),
    paste: () => {
      void clipboard.readText().then((text) => {
        if (text) engine()?.send({ t: "paste", text });
      });
    },
    selectAll: () => engine()?.send({ t: "select-all" }),
    clear: () => engine()?.send({ t: "clear" }),
  };
  const { menus, run } = terminalMenus({
    canCopy: clipboard.canWrite && selected,
    tabs: names,
    active: tabs.list.findIndex((tab) => tab.id === tabs.active),
    canGrow: stepFontSize(fontSize, 1) !== fontSize,
    canShrink: stepFontSize(fontSize, -1) !== fontSize,
    actions: {
      ...actions,
      newWindow: () => newWindow(here()),
      newTab: () => sessions.open(here()),
      closeTab: () => front && requestCloseTab(front.id),
      closeWindow: requestCloseWindow,
      zoom: (step) => setFontSize((size) => (step === 0 ? FONT_SIZE : stepFontSize(size, step))),
      jump: (prompts) => engine()?.send({ t: "jump", prompts }),
      stepTab: (delta) => setTabs((current) => stepTab(current, delta)),
      showIndex: (index) => setTabs((current) => showIndex(current, index)),
    },
  });
  useAppMenus(menus, run);

  const onKeyDown = (key: KeyDownInfo): void => {
    // ❖ chords are the menu bar's (copy, paste, tabs, prompts, windows), not the program's.
    if (key.meta) return;
    if (front?.lost) {
      if (key.key === "enter") sessions.restart(front.id, here());
      return;
    }
    // ⇧PgUp and ⇧PgDn page through the scrollback, as in every terminal; the program never sees them.
    if (key.shift && !key.ctrl && !key.alt && (key.key === "pageup" || key.key === "pagedown")) {
      const page = Math.max(1, (sessions.size.current?.rows ?? 2) - 1);
      engine()?.send({ t: "scroll", lines: key.key === "pageup" ? page : -page });
      return;
    }
    engine()?.send({ t: "key", ...key });
  };

  const question = asking && closeCopy(asking);
  const sheet =
    asking && question ? (
      <ConfirmSheet
        testID="close-running"
        title={question.title}
        message={question.message}
        confirmLabel={question.confirmLabel}
        danger
        onCancel={() => {
          setAsking(null);
          refocus();
        }}
        onConfirm={() => {
          setAsking(null);
          if (asking.kind === "window") onExit();
          else {
            sessions.close(asking.id);
            refocus();
          }
        }}
      />
    ) : undefined;
  const menu = menuAt ? (
    <PopupMenu
      testID="terminal-menu"
      x={menuAt.x}
      y={menuAt.y}
      onClose={() => {
        setMenuAt(null);
        refocus();
      }}
      items={[
        { label: "Copy", keys: "❖C", disabled: !selected, onPress: actions.copy },
        { label: "Paste", keys: "❖V", onPress: actions.paste },
        { label: "Select All", keys: "❖A", onPress: actions.selectAll },
        MENU_SEPARATOR,
        { label: "Clear Scrollback", keys: "❖K", onPress: actions.clear },
      ]}
    />
  ) : undefined;

  return (
    <AppWindow
      title={windowTitle}
      overlay={sheet ?? menu}
      center={
        tabs.list.length > 1 ? (
          <TabStrip
            tabs={tabs.list.map((tab, index) => ({ id: tab.id, name: names[index] ?? "Terminal", rang: tab.rang }))}
            active={tabs.active}
            onSelect={(id) => setTabs((current) => selectTab(current, id))}
            onClose={requestCloseTab}
          />
        ) : undefined
      }
      toolbar={<ToolbarButton testID="terminal-tab-new" glyph={PLUS} tooltip="New tab" onPress={() => sessions.open(here())} />}
    >
      {front && cell ? (
        <Grid
          key={`grid:${gridFocus}:${front.id}`}
          store={sessions.store}
          id={front.id}
          cell={cell}
          palette={palette}
          dark={dark}
          bells={bells}
          lost={front.lost}
          onKeyDown={onKeyDown}
          onSelect={(phase, x, y, clicks) => engine()?.send({ t: "select", phase, x, y, clicks })}
          // A wheel's notch is a whole line: three, as everywhere; a touchpad's fractions go as they come.
          onWheel={(dy) => engine()?.send({ t: "scroll", lines: Number.isInteger(dy) ? dy * 3 : dy })}
          onMark={(y) => engine()?.send({ t: "select-output", y })}
          onContextMenu={(x, y) => setMenuAt({ x, y })}
          onLayout={(area) => {
            bounds.current = area;
            fit();
          }}
        />
      ) : (
        // Before the first tab: the area its grid will have, inside the grid's margin.
        <View
          testID="terminal-starting"
          style={{ flex: 1, backgroundColor: palette.ground }}
          onLayout={(area) => {
            bounds.current = { ...area, width: area.width - MARGIN, height: area.height - GRID_TOP };
            fit();
          }}
        />
      )}
      {/* Measures one cell of the monospace face, again at each size. */}
      <View style={{ position: "absolute", left: 0, top: -200, width: 4000, flexDirection: "row", opacity: 0 }}>
        <View
          key={fontSize}
          testID="terminal-probe"
          style={{ flexShrink: 0 }}
          onLayout={(area) => {
            if (area.width <= 0) return;
            const width = area.width / PROBE.length;
            setCell((now) => (now?.fontSize === fontSize && now.width === width ? now : { width, height: lineHeightFor(fontSize), fontSize }));
          }}
        >
          <Text style={{ fontFamily: "monospace", fontSize, lineHeight: lineHeightFor(fontSize) }}>{PROBE}</Text>
        </View>
      </View>
    </AppWindow>
  );
}
