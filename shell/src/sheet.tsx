/**
 * The shortcut sheet: hold ❖ and it lists the shortcuts that work in the
 * focused app and the system's; release ❖ and it goes away. Opened from the
 * Help menu there is no ❖ to release, so it closes on a click or Esc.
 * An app that publishes its menus (app-menus/) gets its own shortcuts in the
 * app column, as the Mac lists a menu's keys; any other app, the standard ones.
 */

import { Text, View } from "@mirinjs/metal";
import type { PublishedMenus } from "./app-menus/protocol.ts";
import { KeyCatcher } from "./overlay.tsx";
import { Shortcut } from "./shortcut.tsx";
import { useColors } from "./theme.ts";

/** The card's size; its height fits the longest column (MAX_ROWS rows). The surface adds a margin for the corners and shadow. */
export const SHEET = { width: 720, height: 380 } as const;

type Rows = ReadonlyArray<[string, string]>;

/** The app column for an app that publishes no menus: the standard keys. */
const STANDARD_APP: Rows = [["New window", "❖N"], ["Close window", "❖W"], ["Settings", "❖,"], ["Minimize", "❖M"], ["Hide", "❖H"], ["Quit", "❖Q"]];
/** What the shell does for every window, whatever its menus say. */
const WINDOW_KEYS: Rows = [["Close window", "❖W"], ["Minimize", "❖M"], ["Hide", "❖H"], ["Quit", "❖Q"]];
/** Rows a column holds at most: the System column's length, so the sheet never grows. */
export const MAX_ROWS = 11;

/**
 * The app column: an app's own menu rows that show a shortcut, in menu order
 * (one row per shortcut), then the window keys the shell always handles.
 * Without published menus, the standard keys.
 */
export function appRows(published: PublishedMenus | null): Rows {
  if (!published) return STANDARD_APP;
  const taken = new Set(WINDOW_KEYS.map(([, keys]) => keys));
  const own: Array<[string, string]> = [];
  for (const menu of published.menus) {
    for (const row of menu.items) {
      if (row.kind !== "item" || row.shortcut === undefined || taken.has(row.shortcut)) continue;
      taken.add(row.shortcut);
      own.push([row.label.replace(/…$/, ""), row.shortcut]);
    }
  }
  return [...own.slice(0, MAX_ROWS - WINDOW_KEYS.length), ...WINDOW_KEYS];
}

const GROUPS: ReadonlyArray<[string, Rows]> = [
  ["Editing", [["Copy", "❖C"], ["Cut", "❖X"], ["Paste", "❖V"], ["Undo", "❖Z"], ["Redo", "⇧❖Z"], ["Select all", "❖A"], ["Find", "❖F"]]],
  ["Moving in text", [["Line start", "❖←"], ["Line end", "❖→"], ["Previous word", "⌥←"], ["Next word", "⌥→"], ["Top", "❖↑"], ["Delete word", "⌥⌫"]]],
  ["System", [["Launcher", "❖Space"], ["Next app", "❖Tab"], ["Next window", "❖`"], ["Overview", "⌃↑"], ["Spaces", "⌃← ⌃→"], ["Tile left", "⌃❖←"], ["Tile right", "⌃❖→"], ["Fill", "⌃❖↑"], ["Restore", "⌃❖↓"], ["Force Quit", "⌥❖Esc"], ["Dock hiding", "⌥❖D"]]],
];

export function ShortcutSheet({ appName, published = null, onClose }: { appName: string; published?: PublishedMenus | null; onClose?: () => void }) {
  const colors = useColors();
  const groups: ReadonlyArray<[string, Rows]> = [["App", appRows(published)], ...GROUPS];
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }} onPress={onClose}>
      {onClose && <KeyCatcher onKey={(key) => key === "Escape" && onClose()} />}
      <View
        onPress={onClose}
        style={{
          width: SHEET.width,
          flexDirection: "column",
          gap: 14,
          padding: 20,
          borderRadius: 18,
          backgroundColor: colors.launcher,
          borderWidth: 1,
          borderColor: colors.dockBorder,
          shadow: "xl",
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Text style={{ fontSize: 16, fontWeight: "bold", color: colors.text }}>{appName}</Text>
          {onClose ? (
            <Text style={{ fontSize: 12, color: colors.textMuted }}>Keyboard shortcuts · Esc or a click closes</Text>
          ) : (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Text style={{ fontSize: 12, color: colors.textMuted }}>Keyboard shortcuts · release</Text>
              <Shortcut keys="❖" color={colors.textMuted} size={12} />
              <Text style={{ fontSize: 12, color: colors.textMuted }}>to close</Text>
            </View>
          )}
        </View>
        <View style={{ flexDirection: "row", gap: 22 }}>
          {groups.map(([title, rows]) => (
            <View key={title} style={{ flex: 1, flexDirection: "column", gap: 4 }}>
              <Text style={{ fontSize: 11, fontWeight: "bold", color: colors.textMuted }}>{title.toUpperCase()}</Text>
              {rows.map(([label, keys]) => (
                <View key={label} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", height: 22 }}>
                  <Text style={{ fontSize: 13, color: colors.text }}>{label}</Text>
                  <Shortcut keys={keys} color={colors.textMuted} />
                </View>
              ))}
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}
