/**
 * The Terminal's overlay, one at a time: the question when a close would end
 * a running program (ConfirmSheet), else the grid's context menu, else the
 * tabs' menu under the strip's count. A question is answered before any menu.
 */

import { ConfirmSheet, MENU_SEPARATOR, PopupMenu } from "@dashi/ui";
import type { ReactNode } from "react";
import { closeCopy } from "./closing.ts";
import { tabLabel } from "./menus.ts";
import type { Tabs } from "./tabs.ts";
import type { Closing } from "./use-closing.ts";
import type { TerminalMenuActions } from "./use-terminal-menus.ts";

export interface Point {
  x: number;
  y: number;
}

export interface TerminalOverlayInput {
  closing: Closing;
  /** The grid's context menu, at a point, while it is open. */
  menuAt: Point | null;
  /** The selection is there: Copy is on. */
  selected: boolean;
  actions: TerminalMenuActions;
  /** The tab strip's count's menu, at a point, while it is open: every tab, as the View menu lists them. */
  tabsMenuAt: Point | null;
  tabs: Tabs;
  names: readonly string[];
  onSelectTab(id: number): void;
  onCloseMenu(): void;
  onCloseTabsMenu(): void;
}

export function terminalOverlay({
  closing,
  menuAt,
  selected,
  actions,
  tabsMenuAt,
  tabs,
  names,
  onSelectTab,
  onCloseMenu,
  onCloseTabsMenu,
}: TerminalOverlayInput): ReactNode {
  const { asking } = closing;
  const question = asking && closeCopy(asking);
  if (asking && question) {
    return (
      <ConfirmSheet
        testID="close-running"
        title={question.title}
        message={question.message}
        confirmLabel={question.confirmLabel}
        danger
        onCancel={closing.cancel}
        onConfirm={closing.confirm}
      />
    );
  }
  if (menuAt) {
    return (
      <PopupMenu
        testID="terminal-menu"
        x={menuAt.x}
        y={menuAt.y}
        onClose={onCloseMenu}
        items={[
          { label: "Copy", keys: "❖C", disabled: !selected, onPress: actions.copy },
          { label: "Paste", keys: "❖V", onPress: actions.paste },
          { label: "Select All", keys: "❖A", onPress: actions.selectAll },
          MENU_SEPARATOR,
          { label: "Clear Scrollback", keys: "❖K", onPress: actions.clear },
        ]}
      />
    );
  }
  if (tabsMenuAt) {
    return (
      <PopupMenu
        testID="terminal-tabs-menu"
        x={tabsMenuAt.x}
        y={tabsMenuAt.y}
        // Under the count, slid back inside the window rather than flipped over the tabs.
        flip={false}
        onClose={onCloseTabsMenu}
        // The View menu's tab rows, here too: the same names, the same keys.
        items={tabs.list.map((tab, index) => ({
          label: tabLabel(names[index] ?? "Terminal"),
          checked: tab.id === tabs.active,
          ...(index < 8 ? { keys: `❖${index + 1}` } : index === tabs.list.length - 1 ? { keys: "❖9" } : {}),
          onPress: () => onSelectTab(tab.id),
        }))}
      />
    );
  }
  return undefined;
}
