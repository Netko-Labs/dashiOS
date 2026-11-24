/**
 * The shortcut sheet: hold ❖ and it lists the shortcuts that work in the
 * focused app and the system's; release ❖ and it goes away. Opened from the
 * Help menu there is no ❖ to release, so it closes on a click or Esc.
 * An app that publishes its menus (app-menus/) gets its own shortcuts in the
 * app column, as the Mac lists a menu's keys; any other app, the standard ones.
 * Drawn on the kit's sheet card (radius 12, solid, RA-2), its title 13 Bold
 * as every sheet's (CD-2), its column heads captions (600, sentence case).
 */

import { SheetCard, Shortcut, SPACE, TYPE, useColors, WEIGHT } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { KeyCatcher } from "./overlay.tsx";
import type { PublishedMenus } from "./shared/app-menus/index.ts";

/** The card's size: five columns; its height fits the longest (MAX_ROWS rows). The surface adds a margin for the corners and shadow. */
export const SHEET = { width: 860, height: 380 } as const;

type Rows = ReadonlyArray<[string, string]>;

/** The app column for an app that publishes no menus: the standard keys. */
const STANDARD_APP: Rows = [
  ["New window", "❖N"],
  ["Close window", "❖W"],
  ["Settings", "❖,"],
  ["Minimize", "❖M"],
  ["Hide", "❖H"],
  ["Quit", "❖Q"],
];
/** What the shell does for every window, whatever its menus say. */
const WINDOW_KEYS: Rows = [
  ["Close window", "❖W"],
  ["Minimize", "❖M"],
  ["Hide", "❖H"],
  ["Quit", "❖Q"],
];
/** A shortcut's row, and the room between the columns. */
const ROW = 22;
const COLUMN_GAP = SPACE.xl;

/** Rows a column holds at most, so the sheet never grows. */
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
  [
    "Editing",
    [
      ["Copy", "❖C"],
      ["Cut", "❖X"],
      ["Paste", "❖V"],
      ["Undo", "❖Z"],
      ["Redo", "⇧❖Z"],
      ["Select all", "❖A"],
      ["Find", "❖F"],
    ],
  ],
  [
    "Moving in text",
    [
      ["Line start", "❖←"],
      ["Line end", "❖→"],
      ["Previous word", "⌥←"],
      ["Next word", "⌥→"],
      ["Top", "❖↑"],
      ["Delete word", "⌥⌫"],
    ],
  ],
  [
    "System",
    [
      ["Launcher", "❖Space"],
      ["Next app", "❖Tab"],
      ["Next window", "❖`"],
      ["Overview", "⌃↑"],
      ["Spaces", "⌃← ⌃→"],
      ["Lock screen", "⌃❖Q"],
      ["Force Quit", "⌥❖Esc"],
      ["Dock hiding", "⌥❖D"],
      ["Menu bar", "⌃F2"],
    ],
  ],
  [
    // The arrangements (arrange.ts, tiling.ts): a quarter is a half, then an arrow at right angles.
    "Windows",
    [
      ["Left half", "⌃❖←"],
      ["Right half", "⌃❖→"],
      ["Top half", "⌃❖↑"],
      ["Bottom half", "⌃❖↓"],
      ["Quarter", "⌃❖← ↑"],
      ["Fill", "⌃❖↩"],
      ["Center", "⌃❖C"],
      ["Back", "⌃❖R"],
      ["Full screen", "⌃❖F"],
    ],
  ],
];

export function ShortcutSheet({ appName, published = null, onClose }: { appName: string; published?: PublishedMenus | null; onClose?: () => void }) {
  const colors = useColors();
  const groups: ReadonlyArray<[string, Rows]> = [["App", appRows(published)], ...GROUPS];
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }} onPress={onClose}>
      {onClose && <KeyCatcher onKey={(key) => key === "Escape" && onClose()} />}
      <SheetCard testID="shortcut-sheet" width={SHEET.width}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.gap, marginBottom: SPACE.xs }}>
          <Text style={{ fontSize: TYPE.body.size, lineHeight: TYPE.body.line, fontWeight: WEIGHT.bold, color: colors.text }}>{appName}</Text>
          {onClose ? (
            <Text style={{ fontSize: TYPE.secondary.size, color: colors.textMuted }}>Keyboard shortcuts · Esc or a click closes</Text>
          ) : (
            <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.xs }}>
              <Text style={{ fontSize: TYPE.secondary.size, color: colors.textMuted }}>Keyboard shortcuts · release</Text>
              <Shortcut keys="❖" color={colors.textMuted} size={TYPE.secondary.size} />
              <Text style={{ fontSize: TYPE.secondary.size, color: colors.textMuted }}>to close</Text>
            </View>
          )}
        </View>
        <View style={{ flexDirection: "row", gap: COLUMN_GAP }}>
          {groups.map(([title, rows]) => (
            <View key={title} style={{ flex: 1, flexDirection: "column", gap: SPACE.xs }}>
              <Text style={{ fontSize: TYPE.caption.size, lineHeight: TYPE.caption.line, fontWeight: WEIGHT.semibold, color: colors.textMuted }}>{title}</Text>
              {rows.map(([label, keys]) => (
                <View key={label} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", height: ROW }}>
                  <Text style={{ fontSize: TYPE.body.size, color: colors.text }}>{label}</Text>
                  <Shortcut keys={keys} color={colors.textMuted} />
                </View>
              ))}
            </View>
          ))}
        </View>
      </SheetCard>
    </View>
  );
}
