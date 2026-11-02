/** The note list: a column of rows, pinned first, with a date and the first line under each title. */

import { ScrollView, Svg, Text, View } from "@mirinjs/metal";
import { useColors, useSurface } from "@dashi/ui";
import { FOLDER, PIN_FILLED } from "./glyphs.ts";
import { KEEP_DAYS } from "./store.ts";
import type { Row } from "./list.ts";
import { daysLeft, listDate, preview } from "./text.ts";

export const LIST_WIDTH = 276;

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
}

function Caption({ children }: { children: string }) {
  const colors = useColors();
  return (
    <View style={{ paddingHorizontal: 18, paddingTop: 10, paddingBottom: 4, flexShrink: 0 }}>
      <Text style={{ fontSize: 11, fontWeight: "semibold", color: colors.textMuted }}>{children}</Text>
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
  const ink = chosen ? "#ffffff" : colors.text;
  const quiet = chosen ? "#ffffffcc" : colors.textMuted;
  const when = row.deleted ? `${daysLeft(row.deletedAt, now, KEEP_DAYS)} days left` : listDate(row.modified, now);
  return (
    <View
      testID={`note:${row.id}`}
      onPress={onSelect}
      onContextMenu={(event) => onMenu(event.x, event.y)}
      style={{
        flexShrink: 0,
        marginLeft: 8,
        marginRight: 8,
        paddingHorizontal: 10,
        paddingVertical: 7,
        gap: 2,
        borderRadius: 8,
        backgroundColor: chosen ? colors.selection : "#00000000",
        hoverBackgroundColor: chosen ? colors.selection : colors.button,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: "semibold", color: ink }}>
            {row.title === "" ? "New Note" : row.title}
          </Text>
        </View>
        {row.pinned && <Svg markup={PIN_FILLED} size={11} color={quiet} />}
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flexShrink: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: 12, color: ink }}>
            {when}
          </Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: 12, color: quiet }}>
            {preview(row.body) || "No additional text"}
          </Text>
        </View>
      </View>
      {folder !== null && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
          <Svg markup={FOLDER} size={11} color={quiet} />
          <Text numberOfLines={1} style={{ fontSize: 11, color: quiet }}>
            {folder}
          </Text>
        </View>
      )}
    </View>
  );
}

export function NoteList({ rows, selected, onSelect, onMenu, showFolder, folderLabel, now }: NoteListProps) {
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
        width: LIST_WIDTH,
        flexShrink: 0,
        flexDirection: "column",
        paddingVertical: 6,
        gap: 1,
        backgroundColor: surface.window,
        borderRightWidth: 1,
        borderColor: colors.separator,
      }}
    >
      {pinned.length > 0 && <Caption>Pinned</Caption>}
      {pinned.map(render)}
      {pinned.length > 0 && rest.length > 0 && <Caption>Notes</Caption>}
      {rest.map(render)}
    </ScrollView>
  );
}
