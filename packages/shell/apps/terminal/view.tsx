/**
 * The Terminal's window: the compositor's slim title bar (the front tab's
 * program and the grid's size, one line, through `setTitle`), the tab bar
 * once there are two tabs (tab-bar.tsx; each tab its own dashi-term, all at
 * the window's grid), then the front tab's grid, drawn in the monospace
 * face, in Dashi's terminal colors (palette.ts) or the ones a program set.
 * The grid takes the keyboard raw (Metal's `onKeyDown`) and sends every key
 * to the engine, which encodes it the way the program asked
 * (libghostty-vt). The wheel scrolls back; dragging selects (two clicks a
 * word, three a line); the menu bar's Edit menu copies and pastes on ❖C/❖V.
 * Closing a tab or the window while a program runs in it asks first
 * (closing.ts).
 */

import { AppWindow, ConfirmSheet, useColors, useDark } from "@dashi/ui";
import { type Bounds, type KeyDownInfo, type PointerInfo, Text, View } from "@mirinjs/metal";
import { useEffect, useMemo, useRef, useState } from "react";
import { type Clipboard, useAppMenus } from "../kit/index.ts";
import { type CloseQuestion, closeCopy, stillRunning } from "./closing.ts";
import { type Engine, startEngine } from "./engine.ts";
import { FONT_SIZE, LINE_HEIGHT, Line, lookFor } from "./line.tsx";
import { terminalMenus } from "./menus.ts";
import { type TerminalPalette, terminalPalette } from "./palette.ts";
import { applyFrame, cellAt, EMPTY_SCREEN, gridFor, terminalTitle } from "./screen.ts";
import { TabBar } from "./tab-bar.tsx";
import { activeTab, addTab, closeTab, NO_TABS, newTab, selectTab, showIndex, stepTab, type Tabs, updateTab } from "./tabs.ts";

export const TERMINAL_SIZE = { width: 760, height: 480 } as const;
const PROBE = "M".repeat(10);
/** Two presses this close (ms) and this near (cells) count as a double click. */
const MULTI_CLICK_MS = 400;

/** The `colors` message: the palette dashi-term resolves programs' colors through. */
function colorsMessage(palette: TerminalPalette) {
  return { t: "colors", fg: palette.ink, bg: palette.ground, palette: palette.ansi } as const;
}

export interface TerminalWindowProps {
  binary: string;
  onExit(): void;
  newWindow(): void;
  /** Retitle the window (the compositor draws the title bar). */
  setTitle(title: string): void;
  /** Made once, by main.tsx: finding wl-copy is not a render's work. */
  clipboard: Clipboard;
}

export function TerminalWindow({ binary, onExit, newWindow, setTitle: setWindowTitle, clipboard }: TerminalWindowProps) {
  const colors = useColors();
  const dark = useDark();
  const palette = terminalPalette(dark);
  const [tabs, setTabs] = useState<Tabs>(NO_TABS);
  const [cell, setCell] = useState<{ width: number; height: number } | null>(null);
  /** Closing something that still runs a program: the question on screen. */
  const [asking, setAsking] = useState<CloseQuestion | null>(null);
  /** Bumped when a sheet goes, so the grid (mounted again) takes the keyboard back. */
  const [gridFocus, setGridFocus] = useState(0);
  /** Each tab's dashi-term, by tab id. */
  const engines = useRef(new Map<number, Engine>());
  const nextId = useRef(1);
  const grid = useRef<Bounds | null>(null);
  /** The grid every tab runs at; null until the cell is measured. */
  const size = useRef<{ cols: number; rows: number } | null>(null);
  const lastPress = useRef({ at: 0, x: -1, y: -1, clicks: 0 });
  /** The palette a new tab starts with: the one in use now. */
  const paletteNow = useRef(palette);
  paletteNow.current = palette;

  const resizeMessage = (cols: number, rows: number, measured: { width: number; height: number }) =>
    ({ t: "resize", cols, rows, cw: Math.round(measured.width), ch: Math.round(measured.height) }) as const;

  const closeTabById = (id: number): void => {
    engines.current.get(id)?.stop();
    engines.current.delete(id);
    setTabs((current) => closeTab(current, id));
  };

  /** A tab's ×, ❖W: at once at the prompt, else after asking. */
  const requestCloseTab = (id: number): void => {
    const engine = engines.current.get(id);
    if (!engine) return;
    void engine.running().then((program) => {
      if (program === null) closeTabById(id);
      else setAsking({ kind: "tab", id, program });
    });
  };

  /** ⇧❖W, Close Window: at once when every tab is at its prompt, else after asking. */
  const requestCloseWindow = (): void => {
    void Promise.all([...engines.current.values()].map((engine) => engine.running())).then((answers) => {
      const programs = stillRunning(answers);
      if (programs.length === 0) onExit();
      else setAsking({ kind: "window", programs });
    });
  };

  const dismiss = (): void => {
    setAsking(null);
    setGridFocus((n) => n + 1);
  };

  /** A new tab after the one in front, its shell at the window's grid. */
  const openTab = (): void => {
    const at = size.current;
    if (!at || !cell) return;
    const id = nextId.current++;
    const engine = startEngine(binary, at, (message) => {
      if (message.t === "frame") setTabs((current) => updateTab(current, id, (tab) => ({ ...tab, screen: applyFrame(tab.screen, message.frame) })));
      else if (message.t === "title") setTabs((current) => updateTab(current, id, (tab) => ({ ...tab, title: message.title || "Terminal" })));
      else if (message.t === "copied" && message.text) void clipboard.writeText(message.text);
      else if (message.t === "exit") closeTabById(id);
    });
    engine.send(colorsMessage(paletteNow.current));
    engine.send(resizeMessage(at.cols, at.rows, cell));
    engines.current.set(id, engine);
    setTabs((current) => addTab(current, newTab(id)));
  };

  // Every tab follows the window's grid; the first starts once the cell is measured.
  const fit = (): void => {
    const bounds = grid.current;
    if (!cell || !bounds) return;
    const { cols, rows } = gridFor(bounds.width, bounds.height, cell.width, cell.height);
    if (size.current?.cols === cols && size.current.rows === rows) return;
    size.current = { cols, rows };
    for (const engine of engines.current.values()) engine.send(resizeMessage(cols, rows, cell));
    if (engines.current.size === 0 && nextId.current === 1) openTab();
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: fit reads refs; it runs when the cell is first measured.
  useEffect(fit, [cell]);
  // Dark Mode changes every tab's colors; programs' own stay theirs.
  useEffect(() => {
    for (const engine of engines.current.values()) engine.send(colorsMessage(palette));
  }, [palette]);
  useEffect(
    () => () => {
      for (const engine of engines.current.values()) engine.stop();
    },
    [],
  );
  // The last tab closing (its shell exited, or ❖W) closes the window.
  useEffect(() => {
    if (nextId.current > 1 && tabs.list.length === 0) onExit();
  }, [tabs, onExit]);

  const front = activeTab(tabs);
  const screen = front?.screen ?? EMPTY_SCREEN;
  // One object while nothing it is made of changes, so the rows' memo holds.
  const look = useMemo(() => lookFor(palette, dark, colors.selection, screen.fg, screen.bg), [palette, dark, colors.selection, screen.fg, screen.bg]);
  const engine = (): Engine | undefined => (front ? engines.current.get(front.id) : undefined);
  const windowTitle = terminalTitle(front?.title ?? "Terminal", screen.cols, screen.rows);
  useEffect(() => setWindowTitle(windowTitle), [windowTitle, setWindowTitle]);

  const { menus, run } = terminalMenus({
    canCopy: clipboard.canWrite,
    tabs: tabs.list.map((tab) => tab.title),
    active: tabs.list.findIndex((tab) => tab.id === tabs.active),
    actions: {
      copy: () => engine()?.send({ t: "copy" }),
      paste: () => {
        void clipboard.readText().then((text) => {
          if (text) engine()?.send({ t: "paste", text });
        });
      },
      selectAll: () => engine()?.send({ t: "select-all" }),
      newWindow,
      newTab: openTab,
      closeTab: () => front && requestCloseTab(front.id),
      closeWindow: requestCloseWindow,
      stepTab: (delta) => setTabs((current) => stepTab(current, delta)),
      showIndex: (index) => setTabs((current) => showIndex(current, index)),
    },
  });
  useAppMenus(menus, run);

  const onKeyDown = (key: KeyDownInfo): void => {
    // ❖ chords are the menu bar's (copy, paste, tabs, windows), not the program's.
    if (key.meta) return;
    engine()?.send({ t: "key", ...key });
  };

  const onPointer = (event: PointerInfo): void => {
    const bounds = event.bounds ?? grid.current;
    if (!cell || !bounds) return;
    const at = cellAt(event.x - bounds.x, event.y - bounds.y, cell.width, cell.height, screen.cols, screen.rows);
    let clicks = 1;
    if (event.phase === "down") {
      const last = lastPress.current;
      const now = Date.now();
      clicks = now - last.at < MULTI_CLICK_MS && Math.abs(last.x - at.x) <= 1 && last.y === at.y ? Math.min(last.clicks + 1, 3) : 1;
      lastPress.current = { at: now, x: at.x, y: at.y, clicks };
    }
    engine()?.send({ t: "select", phase: event.phase, x: at.x, y: at.y, clicks });
  };

  const question = asking && closeCopy(asking);
  const overlay =
    asking && question ? (
      <ConfirmSheet
        testID="close-running"
        title={question.title}
        message={question.message}
        confirmLabel={question.confirmLabel}
        danger
        onCancel={dismiss}
        onConfirm={() => {
          setAsking(null);
          if (asking.kind === "window") onExit();
          else {
            closeTabById(asking.id);
            setGridFocus((n) => n + 1);
          }
        }}
      />
    ) : undefined;

  const { cursor } = screen;
  return (
    <AppWindow title={windowTitle} overlay={overlay}>
      {tabs.list.length > 1 && (
        <TabBar
          tabs={tabs.list}
          active={tabs.active}
          ground={look.ground}
          shade={dark ? "#141416" : "#ececee"}
          onSelect={(id) => setTabs((current) => selectTab(current, id))}
          onClose={requestCloseTab}
          onNew={openTab}
        />
      )}
      <View style={{ flex: 1, backgroundColor: look.ground, paddingLeft: 8, paddingTop: 6 }}>
        <View
          key={`grid:${gridFocus}`}
          testID="terminal-grid"
          style={{ flex: 1, position: "relative", overflow: "hidden" }}
          onLayout={(bounds) => {
            grid.current = bounds;
            fit();
          }}
          onKeyDown={onKeyDown}
          onWheel={(wheel) => engine()?.send({ t: "scroll", lines: wheel.dy * 3 })}
          onPointer={onPointer}
        >
          {screen.lines.map((spans, y) => (
            <Line key={y} spans={spans} look={look} />
          ))}
          {cell && cursor.visible && (
            <View
              style={{
                position: "absolute",
                left: cursor.x * cell.width,
                top: cursor.y * cell.height + (cursor.style === "underline" ? cell.height - 2 : 0),
                width: cursor.style === "bar" ? 2 : cell.width,
                height: cursor.style === "underline" ? 2 : cell.height,
                backgroundColor: cursor.style === "hollow" ? undefined : look.cursor,
                borderWidth: cursor.style === "hollow" ? 1 : 0,
                borderColor: look.cursor,
                opacity: 0.75,
              }}
            />
          )}
        </View>
        {/* Measures one cell of the monospace face. */}
        <View style={{ position: "absolute", left: 0, top: -LINE_HEIGHT * 3, width: 2000, flexDirection: "row", opacity: 0 }}>
          <View
            style={{ flexShrink: 0 }}
            onLayout={(bounds) => {
              if (bounds.width > 0 && !cell) setCell({ width: bounds.width / PROBE.length, height: LINE_HEIGHT });
            }}
          >
            <Text style={{ fontFamily: "monospace", fontSize: FONT_SIZE, lineHeight: LINE_HEIGHT }}>{PROBE}</Text>
          </View>
        </View>
      </View>
    </AppWindow>
  );
}
