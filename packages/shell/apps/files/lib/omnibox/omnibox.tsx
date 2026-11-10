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

import { rowLook, SelectionBar, useColors } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import { useFilesState } from "../context.ts";
import { sidebarGlyph } from "../glyphs.ts";
import type { Location } from "../location.ts";
import { Crumbs } from "./crumbs.tsx";
import { displayPath } from "./omnibox.ts";
import { Editor } from "./omnibox-editor.tsx";
import type { OmniboxProps, Suggestions } from "./omnibox-props.ts";

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

/** The folders a typed path could go on to, under the field. */
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
        top: bounds.y + bounds.height + 4,
        width: Math.max(bounds.width, 260),
        padding: 5,
        borderRadius: 9,
        backgroundColor: colors.menu,
        borderWidth: 1,
        borderColor: colors.separator,
        shadow: "md",
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
              height: 26,
              paddingHorizontal: 9,
              borderRadius: 5,
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              backgroundColor: look.ground,
              hoverBackgroundColor: look.hover,
            }}
          >
            {index === highlighted && <SelectionBar rowHeight={26} />}
            <Svg markup={sidebarGlyph("folder")} size={13} color={look.glyph} />
            <Text numberOfLines={1} style={{ fontSize: 12.5, color: look.ink }}>
              {item.replace(/\/$/, "").replace(home, "~")}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
