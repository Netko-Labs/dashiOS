/**
 * The note list: a column of rows, pinned first, with a date and the first
 * line under each title, in the one selection look (CO-9) at a row's radius.
 * Empty, it says nothing of its own: the page beside it shows the empty
 * state (PA-7, one at a time).
 */

import { RADIUS, rowLook, SelectionBar, SPACE, TYPE, useColors, useSurface, WEIGHT } from "@dashi/ui";
import { ScrollView, Svg, Text, View } from "@mirinjs/metal";
import { daysLeft, KEEP_DAYS, listDate, preview, untitled } from "../../../../src/shared/notes/index.ts";
import { FOLDER, PIN_FILLED } from "../glyphs.ts";
import type { Row } from "../list.ts";

/** A caption's inset: a row's words' edge (its margin and padding). */
const CAPTION_INSET = SPACE.m + SPACE.gap;
/** The pin and folder marks: the caption's size. */
const MARK = TYPE.caption.size;

export interface NoteListProps {
  rows: readonly Row[];
  selected: string | null;
  onSelect: (id: string) => void;
  onMenu: (row: Row, x: number, y: number) => void;
  /** Show which folder each note is in (All Notes, search results). */
  showFolder: boolean;
  /** Folder names for the default folder. */
  folderLabel: (folder: string) => string;
  now: number;
  /** The list's width (layout.ts: narrower in a narrow window). */
  width: number;
}

function Caption({ children }: { children: string }) {
  const colors = useColors();
  return (
    <View style={{ paddingHorizontal: CAPTION_INSET, paddingTop: SPACE.gap, paddingBottom: SPACE.xs, flexShrink: 0 }}>
      <Text style={{ fontSize: TYPE.caption.size, fontWeight: WEIGHT.semibold, color: colors.textMuted }}>{children}</Text>
    </View>
  );
}

function NoteRow({
  row,
  chosen,
  onSelect,
  onMenu,
  folder,
  now,
}: {
  row: Row;
  chosen: boolean;
  onSelect: () => void;
  onMenu: (x: number, y: number) => void;
  folder: string | null;
  now: number;
}) {
  const colors = useColors();
  const look = rowLook(colors, chosen);
  const { ink, quiet } = look;
  const when = row.deleted ? `${daysLeft(row.deletedAt, now, KEEP_DAYS)} days left` : listDate(row.modified, now);
  return (
    <View
      testID={`note:${row.id}`}
      onPress={onSelect}
      onContextMenu={(event) => onMenu(event.x, event.y)}
      style={{
        flexShrink: 0,
        marginLeft: SPACE.m,
        marginRight: SPACE.m,
        paddingHorizontal: SPACE.gap,
        paddingVertical: SPACE.s,
        gap: SPACE.xxs,
        borderRadius: RADIUS.control,
        backgroundColor: look.ground,
        hoverBackgroundColor: look.hover,
      }}
    >
      {chosen && <SelectionBar />}
      <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.s }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: TYPE.body.size, fontWeight: WEIGHT.semibold, color: ink }}>
            {untitled(row.title)}
          </Text>
        </View>
        {row.pinned && <Svg markup={PIN_FILLED} size={MARK} color={quiet} />}
      </View>
      <View style={{ flexDirection: "row", gap: SPACE.m }}>
        <View style={{ flexShrink: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: TYPE.secondary.size, color: ink }}>
            {when}
          </Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: TYPE.secondary.size, color: quiet }}>
            {preview(row.body) || "No additional text"}
          </Text>
        </View>
      </View>
      {folder !== null && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.xs }}>
          <Svg markup={FOLDER} size={MARK} color={quiet} />
          <View style={{ flexShrink: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ fontSize: TYPE.caption.size, color: quiet }}>
              {folder}
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

export function NoteList({ rows, selected, onSelect, onMenu, showFolder, folderLabel, now, width }: NoteListProps) {
  const colors = useColors();
  const surface = useSurface();
  const pinned = rows.filter((row) => row.pinned);
  const rest = rows.filter((row) => !row.pinned);
  const render = (row: Row) => (
    <NoteRow
      key={row.id}
      row={row}
      chosen={row.id === selected}
      onSelect={() => onSelect(row.id)}
      onMenu={(x, y) => onMenu(row, x, y)}
      folder={showFolder && !row.deleted ? folderLabel(row.folder) : null}
      now={now}
    />
  );
  return (
    <ScrollView
      testID="note-list"
      style={{
        width,
        flexShrink: 0,
        flexDirection: "column",
        paddingVertical: SPACE.s,
        gap: SPACE.px,
        backgroundColor: surface.window,
        borderRightWidth: 1,
        borderColor: colors.separator,
      }}
    >
      {pinned.length > 0 && <Caption>Pinned</Caption>}
      {pinned.map(render)}
      {/* "Others", not "Notes": a folder may be called Notes. */}
      {pinned.length > 0 && rest.length > 0 && <Caption>Others</Caption>}
      {rest.map(render)}
    </ScrollView>
  );
}
