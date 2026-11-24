/**
 * The window's own menus: the toolbar's view pop-up (what the list shows,
 * apps or processes and whose: UI-2's pop-up button), and a line's
 * right-click menu (Inspect, Quit, show or hide an app's processes, and
 * copies). Kernel threads and the summary are the menu bar's View menu's.
 * The menus are the kit's PopupMenu; these are only their rows.
 */

import { MENU_SEPARATOR, type MenuEntry, PopUpButton, ToolbarButton } from "@dashi/ui";
import type { PressInfo } from "@mirinjs/metal";
import type { Line } from "../lines.ts";
import type { ViewChoices } from "../menus.ts";
import { TOOLBAR } from "../toolbar-fit.ts";

/** The button's words: what is listed ("Apps" or "All processes"), and whose. */
export function viewLabel(view: Pick<ViewChoices, "grouped" | "mine">): string {
  if (view.grouped) return view.mine ? "My apps" : "Apps";
  return view.mine ? "My processes" : "All processes";
}

/** The four views the pop-up picks from, each a grouping and a scope. */
export type ViewScope = "apps" | "my-apps" | "all" | "mine";

const SCOPES: readonly { value: ViewScope; grouped: boolean; mine: boolean }[] = [
  { value: "apps", grouped: true, mine: false },
  { value: "my-apps", grouped: true, mine: true },
  { value: "all", grouped: false, mine: false },
  { value: "mine", grouped: false, mine: true },
];

/** Every label the button can show: it is as wide as the longest, whichever it shows, so Quit… and the tabs never move. */
export const VIEW_LABELS = SCOPES.map(viewLabel);

/** Which of the four a view is. */
export function viewScope(view: Pick<ViewChoices, "grouped" | "mine">): ViewScope {
  return SCOPES.find((each) => each.grouped === view.grouped && each.mine === view.mine)?.value ?? "apps";
}

/** The grouping and scope a choice sets. */
export function scopePatch(scope: ViewScope): Pick<ViewChoices, "grouped" | "mine"> {
  const found = SCOPES.find((each) => each.value === scope) ?? SCOPES[0];
  return { grouped: found?.grouped ?? true, mine: found?.mine ?? false };
}

/** A list, for the view button in a narrow window. */
const LIST =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M6 4.5h7.5M6 8h7.5M6 11.5h7.5" fill="none" stroke="#000" stroke-width="1.5" stroke-linecap="round"/><circle cx="3" cy="4.5" r="1" fill="#000"/><circle cx="3" cy="8" r="1" fill="#000"/><circle cx="3" cy="11.5" r="1" fill="#000"/></svg>';

/** The narrow window's menu hangs from the glyph's bottom left, as a toolbar button's menu does (PA-9). */
const menuPoint = (event: PressInfo): [number, number] => [event.bounds?.x ?? 0, (event.bounds?.y ?? 0) + (event.bounds?.height ?? 0)];

/** The view: the kit's pop-up button, or in a narrow window its glyph, which opens the same choices as a menu. */
export function ViewPicker({
  view,
  compact = false,
  onChange,
  onOpen,
}: {
  view: ViewChoices;
  compact?: boolean;
  onChange: (patch: Partial<ViewChoices>) => void;
  onOpen: (x: number, y: number) => void;
}) {
  if (compact) {
    // A narrow window: the glyph alone, its words in the tooltip.
    return (
      <ToolbarButton glyph={LIST} testID="view-menu" tooltip={`Showing ${viewLabel(view).toLowerCase()}`} onPress={(event) => onOpen(...menuPoint(event))} />
    );
  }
  return (
    <PopUpButton
      testID="view-menu"
      width={TOOLBAR.viewLabel}
      options={SCOPES.map((each) => ({ value: each.value, label: viewLabel(each) }))}
      value={viewScope(view)}
      onChange={(scope) => onChange(scopePatch(scope))}
    />
  );
}

/** The narrow window's view menu: the pop-up's four choices. */
export function viewMenuItems(view: ViewChoices, onChange: (patch: Partial<ViewChoices>) => void): MenuEntry[] {
  return SCOPES.map((each) => ({ label: viewLabel(each), checked: viewScope(view) === each.value, onPress: () => onChange(scopePatch(each.value)) }));
}

/** A line's right-click menu: what the menu bar's Process menu holds for it, with the same keys (UI-17). */
export function lineMenuItems({
  line,
  canQuit,
  onInspect,
  onQuit,
  onToggle,
  onCopy,
}: {
  line: Line;
  canQuit: boolean;
  onInspect: () => void;
  onQuit: () => void;
  onToggle: () => void;
  onCopy: (text: string) => void;
}): MenuEntry[] {
  const process = line.process;
  return [
    { label: "Inspect…", keys: "❖I", onPress: onInspect },
    { label: "Quit…", keys: "❖K", onPress: onQuit, disabled: !canQuit },
    ...(line.expandable ? [MENU_SEPARATOR, { label: line.expanded ? "Hide Processes" : "Show Processes", onPress: onToggle }] : []),
    MENU_SEPARATOR,
    ...(process
      ? [
          { label: "Copy PID", onPress: () => onCopy(String(process.pid)) },
          { label: "Copy Command Line", onPress: () => onCopy(process.command), disabled: process.command === "" },
        ]
      : [{ label: "Copy Name", onPress: () => onCopy(line.name) }]),
  ];
}
