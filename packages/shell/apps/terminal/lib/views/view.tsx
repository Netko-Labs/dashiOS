/**
 * The Terminal's window, its layout only: one chrome row (VS-1), the unified
 * title bar with the front tab's name, or the tabs themselves once there are
 * two (VS-4, tab-strip.tsx), and a + for a new tab; then the front tab's grid
 * (terminal-body.tsx), in Dashi's terminal colors (palette.ts) or the ones a
 * program set. Each tab is its own dashi-term (sessions.ts) with the shell
 * integration, so tabs are named by folder and command (naming.ts), new
 * tabs and windows open where the front tab is, ❖↑ ❖↓ jump between
 * prompts and failed commands are marked in the margin. The grid takes the
 * keyboard raw and sends every key to the engine, which encodes it the way
 * the program asked (libghostty-vt); ⇧PgUp and ⇧PgDn page through the
 * scrollback. The hooks hold the rest: the tabs and their shells
 * (sessions.ts), the size (use-grid-size.ts), the closing questions
 * (use-closing.ts), the menus (use-terminal-menus.ts), and the window's
 * standing effects (use-window-lifecycle.ts).
 */

import { hostname } from "node:os";
import { AppWindow, EmptyState, ToolbarButton, useDark } from "@dashi/ui";
import type { KeyDownInfo } from "@mirinjs/metal";
import { useState } from "react";
import type { Clipboard } from "../../../kit/index.ts";
import { useClosing } from "../hooks/use-closing.ts";
import { useGridSize } from "../hooks/use-grid-size.ts";
import { useTabSessions } from "../hooks/use-tab-sessions.ts";
import { useTerminalMenus } from "../hooks/use-terminal-menus.ts";
import { useWindowLifecycle } from "../hooks/use-window-lifecycle.ts";
import { routeKey } from "../key-routing.ts";
import { localFolder, tabName } from "../naming.ts";
import { terminalPalette } from "../palette.ts";
import { useScreenPart } from "../store.ts";
import { activeTab, selectTab } from "../tabs.ts";
import { FONT_SIZE } from "./line.tsx";
import { TerminalBody } from "./terminal-body.tsx";
import { type Point, terminalOverlay } from "./terminal-overlay.tsx";
import { titleCenter } from "./title-center.tsx";

export const TERMINAL_SIZE = { width: 760, height: 480 } as const;
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
  /** What the first tab runs in place of the shell (`… -e htop`: an app whose desktop entry says `Terminal=true`). */
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

/** The two menus' places, and the grid's turn at the keyboard when one goes. */
function useMenusAt() {
  const [menuAt, setMenuAt] = useState<Point | null>(null);
  /** The tab strip's count was pressed: the menu of every tab, under it. */
  const [tabsMenuAt, setTabsMenuAt] = useState<Point | null>(null);
  /** Bumped when a sheet goes, so the grid (mounted again) takes the keyboard back. */
  const [gridFocus, setGridFocus] = useState(0);
  const refocus = (): void => setGridFocus((n) => n + 1);
  const closeMenu = (): void => {
    setMenuAt(null);
    refocus();
  };
  const closeTabsMenu = (): void => {
    setTabsMenuAt(null);
    refocus();
  };
  return { menuAt, setMenuAt, tabsMenuAt, setTabsMenuAt, closeMenu, closeTabsMenu, gridFocus, refocus };
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
  const [fontSize, setFontSize] = useState(FONT_SIZE);
  const { menuAt, setMenuAt, tabsMenuAt, setTabsMenuAt, closeMenu, closeTabsMenu, gridFocus, refocus } = useMenusAt();
  const { tabs, setTabs, sessions, bells } = useTabSessions({ binary, clipboard, palette });

  const front = activeTab(tabs);
  const engine = () => (front ? sessions.engine(front.id) : undefined);
  /** Where a new tab or window opens: the front tab's folder, on this machine. */
  const here = (): string | null => localFolder(front?.naming.folder, hostname());
  const selected = useScreenPart(sessions.store, front?.id ?? -1, (screen) => screen.selected);
  const closing = useClosing({ sessions, onExit, refocus });
  const grid = useGridSize({ sessions, firstFolder, firstCommand, fontSize });
  const names = tabs.list.map((tab) => tabName(tab.naming, home));
  const windowTitle = front ? tabName(front.naming, home) : "Terminal";
  useWindowLifecycle({ sessions, palette, tabs, onExit, title: windowTitle, setWindowTitle });
  const actions = useTerminalMenus({ clipboard, selected, tabs, names, front, fontSize, setFontSize, setTabs, engine, here, sessions, newWindow, closing });

  const onKeyDown = (key: KeyDownInfo): void =>
    routeKey(key, {
      front,
      send: (input) => engine()?.send(input),
      restart: () => front && sessions.restart(front.id, here()),
      pageRows: Math.max(1, (sessions.size.current?.rows ?? 2) - 1),
    });
  const selectTabId = (id: number): void => setTabs((current) => selectTab(current, id));

  return (
    <AppWindow
      title={windowTitle}
      overlay={terminalOverlay({
        closing,
        menuAt,
        selected,
        actions,
        tabsMenuAt,
        tabs,
        names,
        onSelectTab: selectTabId,
        onCloseMenu: closeMenu,
        onCloseTabsMenu: closeTabsMenu,
      })}
      center={titleCenter({
        tabs,
        names,
        onSelect: selectTabId,
        onClose: closing.requestCloseTab,
        onMore: (at) => setTabsMenuAt({ x: at.x, y: at.y + at.height + 4 }),
      })}
      toolbar={<ToolbarButton testID="terminal-tab-new" glyph={PLUS} tooltip="New tab" onPress={() => sessions.open(here())} />}
    >
      <TerminalBody
        front={front}
        store={sessions.store}
        grid={grid}
        palette={palette}
        dark={dark}
        bells={bells}
        gridFocus={gridFocus}
        fontSize={fontSize}
        onKeyDown={onKeyDown}
        send={(input) => engine()?.send(input)}
        onContextMenu={(x, y) => setMenuAt({ x, y })}
      />
    </AppWindow>
  );
}
