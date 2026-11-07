/**
 * The window's own menus: the toolbar's view button (what the list shows,
 * the twin of the menu bar's View menu) and a line's right-click menu
 * (Inspect, Quit, show or hide an app's processes, and copies).
 */

import { MENU_SEPARATOR, type MenuEntry, PopupMenu, useColors } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import type { Line } from "./lines.ts";
import type { ViewChoices } from "./menus.ts";

/** The button's words: what is listed ("Apps" or "All processes"), and whose. */
export function viewLabel(view: Pick<ViewChoices, "grouped" | "mine">): string {
  if (view.grouped) return view.mine ? "My apps" : "Apps";
  return view.mine ? "My processes" : "All processes";
}

export function ViewButton({ view, onOpen }: { view: ViewChoices; onOpen: (x: number, y: number) => void }) {
  const colors = useColors();
  return (
    <View
      testID="view-menu"
      accessibilityRole="button"
      accessibilityLabel={`Showing ${viewLabel(view).toLowerCase()}`}
      onPress={(event) => onOpen(Math.max((event.bounds?.x ?? 0) - 40, 8), (event.bounds?.y ?? 0) + (event.bounds?.height ?? 28) + 4)}
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
      <Text numberOfLines={1} style={{ fontSize: 12, color: colors.text }}>
        {viewLabel(view)}
      </Text>
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
