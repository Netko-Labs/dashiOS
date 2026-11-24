/**
 * The tape: the sums worked out, newest at the top, beside the keypad. Its
 * head is a side column's (VS-9): in the window controls' row, 38 tall, its
 * name 13 Bold and its one action, Clear Tape, a toolbar button at the end;
 * no row under it. The entries are a list (a listbox of rows, CO-9's
 * selection look): a click on one puts its result in the line at the caret
 * and makes it the chosen entry, which the Edit menu's Use Result, Edit Sum
 * and Copy Sum act on; a right-click offers the same rows by the same names
 * (menus.ts `TAPE_COMMANDS`), and the entry's result to copy. Empty, it says
 * so in one muted line (EmptyState's panel form, PA-7).
 */

import {
  CLEAR as CLEAR_GLYPH,
  EmptyState,
  MENU_SEPARATOR,
  type MenuEntry,
  RADIUS,
  rowLook,
  SelectionBar,
  SPACE,
  ToolbarButton,
  TYPE,
  useColors,
  useSurface,
  WEIGHT,
} from "@dashi/ui";
import { ScrollView, Text, View } from "@mirinjs/metal";
import { formatResult } from "./format.ts";
import { TAPE_WIDTH } from "./layout.ts";
import { shownExpression, type TapeEntry } from "./line.ts";
import type { NumberLocale } from "./locale.ts";
import { TAPE_COMMANDS } from "./menus.ts";

/** The list's side padding and a row's: a row's words end 16 in. */
const LIST_INSET = SPACE.s;
const ROW_INSET = SPACE.gap;
/** The head's inset, both ends: the rows', so Clear ends where the results do (and clear of the window's corner). */
const HEAD_INSET = LIST_INSET + ROW_INSET;
/** A side column's head: the controls' row (VS-9). */
const HEAD_HEIGHT = 38;

/** A menu to open at a point in the window. */
export interface MenuAt {
  x: number;
  y: number;
  items: MenuEntry[];
}

export interface TapeProps {
  tape: readonly TapeEntry[];
  locale: NumberLocale;
  /** The window controls' strip: the head is as tall. */
  headHeight: number;
  canCopy: boolean;
  /** The chosen entry, by its place in the tape. */
  chosen: number | null;
  onChoose: (index: number) => void;
  onUse: (entry: TapeEntry) => void;
  onEdit: (index: number) => void;
  onCopy: (text: string) => void;
  onCopyResult: (entry: TapeEntry) => void;
  onClear: () => void;
  onMenu: (menu: MenuAt) => void;
}

function TapeRow({
  entry,
  locale,
  chosen,
  onPress,
  onMenu,
}: {
  entry: TapeEntry;
  locale: NumberLocale;
  chosen: boolean;
  onPress: () => void;
  onMenu: (x: number, y: number) => void;
}) {
  const colors = useColors();
  const look = rowLook(colors, chosen);
  const sum = shownExpression(entry.expression, locale);
  const result = `= ${formatResult(entry.value, locale)}`;
  return (
    <View
      onPress={onPress}
      onContextMenu={(point) => onMenu(point.x, point.y)}
      accessibilityRole="option"
      accessibilityLabel={`${sum} ${result}`}
      accessibilityState={{ selected: chosen }}
      style={{
        // Stretched, so each line has the row's width to sit at the right of (and the sum to wrap in).
        flexDirection: "column",
        alignItems: "stretch",
        gap: SPACE.xxs,
        paddingVertical: SPACE.s,
        paddingHorizontal: ROW_INSET,
        borderRadius: RADIUS.control,
        position: "relative",
        backgroundColor: look.ground,
        hoverBackgroundColor: look.hover,
      }}
    >
      {chosen && <SelectionBar />}
      <Text style={{ fontSize: TYPE.secondary.size, color: look.quiet, textAlign: "right" }}>{sum}</Text>
      {/* No line limit: the host measures a one-line clamp in a stretched, right-aligned column too narrow and draws only "…" (review 21). */}
      <Text style={{ fontSize: TYPE.heading.size, color: look.ink, textAlign: "right" }}>{result}</Text>
    </View>
  );
}

/** The column's head, in the controls' row: "Tape" and Clear Tape at its end. */
function TapeHead({ height, canClear, onClear }: { height: number; canClear: boolean; onClear: () => void }) {
  const colors = useColors();
  return (
    <View dragRegion style={{ height, flexShrink: 0, flexDirection: "row", alignItems: "center", paddingLeft: HEAD_INSET, paddingRight: HEAD_INSET - SPACE.m }}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: TYPE.body.size, fontWeight: WEIGHT.bold, color: colors.text }}>Tape</Text>
      </View>
      {canClear && <ToolbarButton testID="tape-clear" glyph={CLEAR_GLYPH} tooltip="Clear Tape" onPress={onClear} />}
    </View>
  );
}

export function Tape({ tape, locale, headHeight, canCopy, chosen, onChoose, onUse, onEdit, onCopy, onCopyResult, onClear, onMenu }: TapeProps) {
  const colors = useColors();
  const surface = useSurface();
  const menuFor = (entry: TapeEntry, index: number): MenuEntry[] => [
    { label: TAPE_COMMANDS.use.label, onPress: () => onUse(entry) },
    { label: TAPE_COMMANDS.edit.label, onPress: () => onEdit(index) },
    MENU_SEPARATOR,
    { label: "Copy Result", disabled: !canCopy, onPress: () => onCopyResult(entry) },
    { label: TAPE_COMMANDS.copySum.label, disabled: !canCopy, onPress: () => onCopy(shownExpression(entry.expression, locale)) },
    MENU_SEPARATOR,
    { label: "Clear Tape", onPress: onClear },
  ];
  return (
    <View
      testID="tape"
      style={{
        width: TAPE_WIDTH,
        flexShrink: 0,
        flexDirection: "column",
        backgroundColor: surface.sidebar,
        borderLeftWidth: SPACE.px,
        borderColor: colors.separator,
      }}
    >
      <TapeHead height={Math.max(headHeight, HEAD_HEIGHT)} canClear={tape.length > 0} onClear={onClear} />
      {tape.length === 0 ? (
        <View style={{ flex: 1, justifyContent: "center" }}>
          <EmptyState testID="tape-empty" variant="panel" title="Your sums show up here." />
        </View>
      ) : (
        <ScrollView testID="tape-rows" style={{ flex: 1, flexDirection: "column", paddingHorizontal: LIST_INSET, paddingBottom: SPACE.m }}>
          <View accessibilityRole="listbox" accessibilityLabel="Tape" style={{ flexDirection: "column" }}>
            {tape
              .map((entry, index) => ({ entry, index }))
              .reverse()
              .map(({ entry, index }) => (
                <TapeRow
                  key={String(index)}
                  entry={entry}
                  locale={locale}
                  chosen={index === chosen}
                  onPress={() => {
                    onChoose(index);
                    onUse(entry);
                  }}
                  onMenu={(x, y) => {
                    onChoose(index);
                    onMenu({ x, y, items: menuFor(entry, index) });
                  }}
                />
              ))}
          </View>
        </ScrollView>
      )}
    </View>
  );
}
