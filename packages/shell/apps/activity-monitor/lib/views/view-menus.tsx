/**
 * The window's own menus: the toolbar's view button (what the list shows,
 * the twin of the menu bar's View menu) and a line's right-click menu
 * (Inspect, Quit, show or hide an app's processes, and copies).
 */

import { MENU_SEPARATOR, type MenuEntry, PopupMenu, ToolbarButton, useColors } from "@dashi/ui";
import { type PressInfo, Text, View } from "@mirinjs/metal";
import type { Line } from "../lines.ts";
import type { ViewChoices } from "../menus.ts";

/** The button's words: what is listed ("Apps" or "All processes"), and whose. */
export function viewLabel(view: Pick<ViewChoices, "grouped" | "mine">): string {
  if (view.grouped) return view.mine ? "My apps" : "Apps";
  return view.mine ? "My processes" : "All processes";
}

/** Every label the button can show: it is as wide as the longest, whichever it shows, so Quit… and the tabs never move. */
export const VIEW_LABELS = [
  viewLabel({ grouped: true, mine: false }),
  viewLabel({ grouped: true, mine: true }),
  viewLabel({ grouped: false, mine: false }),
  viewLabel({ grouped: false, mine: true }),
] as const;

/** A list, for the view button in a narrow window. */
const LIST =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M6 4.5h7.5M6 8h7.5M6 11.5h7.5" fill="none" stroke="#000" stroke-width="1.5" stroke-linecap="round"/><circle cx="3" cy="4.5" r="1" fill="#000"/><circle cx="3" cy="8" r="1" fill="#000"/><circle cx="3" cy="11.5" r="1" fill="#000"/></svg>';

const menuPoint = (event: PressInfo): [number, number] => [Math.max((event.bounds?.x ?? 0) - 40, 8), (event.bounds?.y ?? 0) + (event.bounds?.height ?? 28) + 4];

export function ViewButton({ view, compact = false, onOpen }: { view: ViewChoices; compact?: boolean; onOpen: (x: number, y: number) => void }) {
  const colors = useColors();
  const shown = viewLabel(view);
  if (compact) {
    // A narrow window: the glyph alone, its words in the tooltip.
    return <ToolbarButton glyph={LIST} testID="view-menu" tooltip={`Showing ${shown.toLowerCase()}`} onPress={(event) => onOpen(...menuPoint(event))} />;
  }
  return (
    <View
      testID="view-menu"
      accessibilityRole="button"
      accessibilityLabel={`Showing ${shown.toLowerCase()}`}
      onPress={(event) => onOpen(...menuPoint(event))}
      style={{
        height: 28,
        flexShrink: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 8,
        borderRadius: 7,
        hoverBackgroundColor: colors.button,
      }}
    >
      {/* Every label stacked, the others folded to no height: the column is as wide as the longest. */}
      <View testID="view-menu:labels" style={{ flexDirection: "column", flexShrink: 0 }}>
        {VIEW_LABELS.map((label) => (
          <View key={label} style={label === shown ? {} : { height: 0, overflow: "hidden" }}>
            <Text numberOfLines={1} style={{ fontSize: 12, color: label === shown ? colors.text : "#00000000" }}>
              {label}
            </Text>
          </View>
        ))}
      </View>
      <Text style={{ fontSize: 9, color: colors.textMuted }}>▼</Text>
    </View>
  );
}

export function ViewMenu({
  x,
  y,
  view,
  onChange,
  onClose,
}: {
  x: number;
  y: number;
  view: ViewChoices;
  onChange: (patch: Partial<ViewChoices>) => void;
  onClose: () => void;
}) {
  const items: MenuEntry[] = [
    { label: "Group by App", checked: view.grouped, onPress: () => onChange({ grouped: !view.grouped }) },
    MENU_SEPARATOR,
    { label: "All Processes", checked: !view.mine, onPress: () => onChange({ mine: false }) },
    { label: "My Processes", checked: view.mine, onPress: () => onChange({ mine: true }) },
    { label: "Kernel Threads", checked: view.kernel, onPress: () => onChange({ kernel: !view.kernel }) },
    MENU_SEPARATOR,
    { label: "Show Summary", checked: view.summary, onPress: () => onChange({ summary: !view.summary }) },
  ];
  return <PopupMenu testID="view-menu-items" x={x} y={y} onClose={onClose} items={items} />;
}

export function ContextMenu({
  x,
  y,
  line,
  canQuit,
  onInspect,
  onQuit,
  onToggle,
  onCopy,
  onClose,
}: {
  x: number;
  y: number;
  line: Line;
  canQuit: boolean;
  onInspect: () => void;
  onQuit: () => void;
  onToggle: () => void;
  onCopy: (text: string) => void;
  onClose: () => void;
}) {
  const process = line.process;
  const items: MenuEntry[] = [
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
  return <PopupMenu testID="line-menu" x={x} y={y} onClose={onClose} items={items} />;
}
