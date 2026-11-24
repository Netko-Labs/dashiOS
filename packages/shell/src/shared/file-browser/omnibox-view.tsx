/**
 * The omnibox: the toolbar's one field for where you are and what you look
 * for. At rest it is a magnifier, the path as crumbs (click one to go there;
 * drop files on one to move them there; a deep path folds its first folders
 * into “…”) and, at its end, the folder's status line, which gives way when
 * the field is narrow. A click on its empty part (or ❖F) is a search, empty,
 * ready to type; Go to Folder… (⇧❖G) puts the folder's path in it. Text that
 * starts like a path (`/`, `~`) goes there, with its subfolders offered
 * under it (↑↓ to pick, Enter to go); anything else searches as you type,
 * the results in the listing, in this folder or everywhere (a two-way
 * switch). Escape gives the crumbs back.
 */

import { MENU, rowLook, SelectionBar, SHADOW, SPACE, TYPE, useColors } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import { useFilesState } from "./context.ts";
import { sidebarGlyph } from "./glyphs.ts";
import { Crumbs } from "./lib/omnibox/crumbs.tsx";
import { Editor } from "./lib/omnibox/editor.tsx";
import type { Location } from "./location.ts";
import { displayPath } from "./omnibox.ts";
import type { OmniboxProps, Suggestions } from "./omnibox-props.ts";

/** The list is at least this wide under a narrow field. */
const SUGGESTIONS_LEAST = 260;

/** What the box holds when editing starts: the folder's path, ready for a name after it. */
export function editText(location: Location, home: string): string {
  if (location.kind !== "folder") return "";
  const shown = displayPath(location.path, home);
  return shown.endsWith("/") ? shown : `${shown}/`;
}

export function Omnibox(props: OmniboxProps) {
  const state = useFilesState();
  if (props.editing === null && state.query === "") return <Crumbs onEdit={props.onEdit} />;
  // A new edit starts from its own text; a search left standing shows its query.
  return <Editor key={`${props.session ?? 0}:${props.editing ?? "query"}`} {...props} />;
}

/** The folders a typed path could go on to, under the field: a menu (LA-4), its rows the selection look while picked. */
export function SuggestionList({ suggestions, home }: { suggestions: Suggestions; home: string }) {
  const colors = useColors();
  const { bounds, items, highlighted, pick } = suggestions;
  return (
    <View
      testID="omnibox:suggestions"
      occlude
      style={{
        position: "absolute",
        left: bounds.x,
        top: bounds.y + bounds.height + SPACE.xs,
        width: Math.max(bounds.width, SUGGESTIONS_LEAST),
        padding: MENU.padding,
        borderRadius: MENU.radius,
        backgroundColor: colors.menu,
        borderWidth: MENU.edge,
        borderColor: colors.menuEdge,
        shadow: SHADOW.xl,
      }}
    >
      {items.map((item, index) => {
        const look = rowLook(colors, index === highlighted);
        return (
          <View
            key={item}
            testID={`omnibox:suggestion:${index}`}
            onPress={() => pick(index)}
            style={{
              height: MENU.row,
              paddingHorizontal: MENU.inset,
              borderRadius: MENU.rowRadius,
              flexDirection: "row",
              alignItems: "center",
              gap: SPACE.m,
              backgroundColor: look.ground,
              hoverBackgroundColor: look.hover,
            }}
          >
            {index === highlighted && <SelectionBar rowHeight={MENU.row} />}
            <Svg markup={sidebarGlyph("folder")} size={TYPE.body.size} color={look.glyph} />
            <Text numberOfLines={1} style={{ fontSize: TYPE.body.size, color: look.ink }}>
              {item.replace(/\/$/, "").replace(home, "~")}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
