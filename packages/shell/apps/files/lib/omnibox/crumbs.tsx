/**
 * The omnibox at rest: a magnifier, the path as crumbs (click one to go
 * there; drop files on one to move them there; a deep path folds its first
 * folders into “…”) and, at its end, the folder's status line, which gives
 * way when the field is narrow.
 */

import { SEARCH, useColors } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import { useState } from "react";
import { useFiles, useFilesState } from "../../../../src/shared/file-browser/context.ts";
import { useDropTarget } from "../../../../src/shared/file-browser/drop.ts";
import { CHEVRON } from "../../../../src/shared/file-browser/glyphs.ts";
import { type Location, pathSegments } from "../../../../src/shared/file-browser/location.ts";
import { textWidth } from "../../../../src/shared/file-browser/tile-name.ts";
import { statusLine } from "../views/footer.tsx";
import { Field, HEIGHT } from "./omnibox-field.tsx";

/** Crumbs shown in full before the first ones fold into “…”. */
const CRUMBS_SHOWN = 4;
/** Below this width the status line gives way to the crumbs. */
const STATUS_FROM = 420;
/** What the field takes besides its crumbs: its padding (4 and 8), the magnifier (22) and the gaps between its parts. */
const FIELD_CHROME = 40;

/** The crumbs to draw: all of a short path; else the first, “…” (for the folders folded), and the last few. */
export function foldCrumbs<T>(segments: readonly T[], shown: number = CRUMBS_SHOWN): Array<{ segment: T; folded: boolean }> {
  if (segments.length <= shown) return segments.map((segment) => ({ segment, folded: false }));
  const tail = segments.slice(segments.length - (shown - 1));
  const hidden = segments[segments.length - shown] as T;
  return [{ segment: segments[0] as T, folded: false }, { segment: hidden, folded: true }, ...tail.map((segment) => ({ segment, folded: false }))];
}

/** A crumb's estimated width: its name at 13 px (the current one semibold), 6 either side, and the chevron before all but the first. */
const crumbWidth = (name: string, first: boolean, last: boolean): number => textWidth(name) * 13 * (last ? 1.06 : 1) + 12 + (first ? 0 : 10);

/**
 * The crumbs that fit `room` pixels, folded from the left: the whole path
 * (a deep one folded as `foldCrumbs` does), then fewer of its last folders
 * after the first and “…”, then “…” and the current folder, and at the least
 * the current folder alone, which ends in an ellipsis when even it is too
 * wide. Never a parent cut mid-word. `room` 0 (not laid out yet): the whole path.
 */
export function fitCrumbs<T extends { name: string }>(segments: readonly T[], room: number): Array<{ segment: T; folded: boolean }> {
  const last = segments.at(-1);
  if (last === undefined) return [];
  const options: Array<Array<{ segment: T; folded: boolean }>> = [];
  for (let shown = Math.min(CRUMBS_SHOWN, segments.length); shown >= 2; shown--) options.push(foldCrumbs(segments, shown));
  const parent = segments.at(-2);
  if (parent !== undefined)
    options.push([
      { segment: parent, folded: true },
      { segment: last, folded: false },
    ]);
  options.push([{ segment: last, folded: false }]);
  const width = (crumbs: ReadonlyArray<{ segment: T; folded: boolean }>): number =>
    crumbs.reduce((sum, crumb, at) => sum + crumbWidth(crumb.folded ? "…" : crumb.segment.name, at === 0, at === crumbs.length - 1), 0);
  if (room <= 0) return options[0] ?? [];
  return options.find((crumbs) => width(crumbs) <= room) ?? options.at(-1) ?? [];
}

export function Crumbs({ onEdit }: { onEdit: (text: string) => void }) {
  const colors = useColors();
  const { store } = useFiles();
  const state = useFilesState();
  const segments = pathSegments(state.location, store.env.home, store.env.trash.files);
  const visible = store.visible();
  const chosen = new Set(state.selection);
  const picked = visible.filter((item) => chosen.has(item.path));
  const [width, setWidth] = useState(0);
  // A click on the field is a search, empty and ready to type (a path, typed, goes there).
  const search = (): void => onEdit("");
  const status = statusLine(visible.length, picked, state.free?.free ?? null);
  const showsStatus = width === 0 || width >= STATUS_FROM;
  // The crumbs fold from the left to fit what the field has left beside the status line.
  const room = width === 0 ? 0 : Math.max(1, width - FIELD_CHROME - (showsStatus ? textWidth(status) * 11 : 0));
  const folded = fitCrumbs(
    segments.map((segment, index) => ({ ...segment, index })),
    room,
  );
  return (
    <Field testID="omnibox" onPress={search} onLayout={(bounds) => setWidth(Math.round(bounds.width))}>
      <View style={{ width: 22, alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <Svg markup={SEARCH} size={13} color={colors.textMuted} />
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 0, minWidth: 0, flexShrink: 1, overflow: "hidden" }}>
        {folded.map(({ segment, folded: hidden }, at) => (
          <Crumb
            key={`${segment.index}:${segment.name}`}
            index={segment.index}
            name={hidden ? "…" : segment.name}
            location={segment.location}
            first={at === 0}
            last={segment.index === segments.length - 1}
          />
        ))}
      </View>
      {/* The empty end is a search too, but the whole field already is one: in a narrow window it gives its room to the crumbs. */}
      <View testID="omnibox:edit" onPress={search} style={{ flex: 1, height: HEIGHT, minWidth: 0 }} />
      {showsStatus && (
        <View testID="status" style={{ flexShrink: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: 11, color: colors.textMuted }}>
            {status}
          </Text>
        </View>
      )}
    </Field>
  );
}

function Crumb({ index, name, location, first, last }: { index: number; name: string; location: Location; first: boolean; last: boolean }) {
  const colors = useColors();
  const { store } = useFiles();
  const drop = useDropTarget(location.kind === "folder" ? location.path : location.kind === "trash" ? "trash" : null);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", flexShrink: last ? 1 : 0, minWidth: 0 }}>
      {!first && <Svg markup={CHEVRON} size={10} color={colors.textDisabled} />}
      <View
        testID={`path:${index}`}
        onPress={() => store.go(location)}
        {...drop.props}
        style={{
          height: 22,
          paddingHorizontal: 6,
          justifyContent: "center",
          borderRadius: 5,
          minWidth: 0,
          // The current folder gives way last and ends in an ellipsis; a parent is folded into “…” before it is cut.
          flexShrink: last ? 1 : 0,
          hoverBackgroundColor: colors.button,
          ...(drop.over ? { backgroundColor: `${colors.selection}33` } : {}),
        }}
      >
        <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: last ? "semibold" : "normal", color: last ? colors.text : colors.textMuted }}>
          {name}
        </Text>
      </View>
    </View>
  );
}
