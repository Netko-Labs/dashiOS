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

import { rowLook, SEARCH, Segmented, SelectionBar, useColors } from "@dashi/ui";
import { type Bounds, Svg, Text, TextInput, View } from "@mirinjs/metal";
import { useEffect, useMemo, useState } from "react";
import { useFiles, useFilesState } from "./context.ts";
import { useDropTarget } from "./drop.ts";
import { statusLine } from "./footer.tsx";
import { CHEVRON, CLOSE, sidebarGlyph } from "./glyphs.ts";
import { type Location, pathSegments } from "./location.ts";
import { completions, displayPath, intentOf } from "./omnibox.ts";
import { textWidth } from "./tile-name.ts";

const HEIGHT = 28;
/** Crumbs shown in full before the first ones fold into “…”. */
const CRUMBS_SHOWN = 4;
/** Below this width the status line gives way to the crumbs. */
const STATUS_FROM = 420;
/** The least the field gets in a narrow window: the magnifier and the current folder, cut. */
const MIN_WIDTH = 96;
/** What the field takes besides its crumbs: its padding (4 and 8), the magnifier (22), the gaps between its parts, and the least of its empty end (24). */
const FIELD_CHROME = 64;

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

/** Folders offered under the field while a path is typed, for the window's overlay to draw. */
export interface Suggestions {
  bounds: Bounds;
  items: readonly string[];
  highlighted: number;
  pick(index: number): void;
}

export interface OmniboxProps {
  /** The text being edited, or null at rest. */
  editing: string | null;
  /** Counts the edits started: each starts a fresh field, never one still holding the last one's text. */
  session?: number;
  onEdit(text: string): void;
  onDone(): void;
  onSuggest(suggestions: Suggestions | null): void;
}

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

function Field({
  children,
  testID,
  onLayout,
  onPress,
}: {
  children: React.ReactNode;
  testID: string;
  onLayout?: (bounds: Bounds) => void;
  /** At rest: the box is the window's first Tab stop, and Space or Return makes it text (KB-1). */
  onPress?: () => void;
}) {
  const colors = useColors();
  return (
    <View
      testID={testID}
      {...(onLayout ? { onLayout } : {})}
      {...(onPress ? { focusable: true, onPress, accessibilityRole: "button" as const, accessibilityLabel: "Path. Press to search, or type a path" } : {})}
      style={{
        flex: 1,
        minWidth: MIN_WIDTH,
        height: HEIGHT,
        flexDirection: "row",
        alignItems: "center",
        gap: 2,
        paddingLeft: 4,
        paddingRight: 8,
        borderRadius: 8,
        backgroundColor: colors.button,
      }}
    >
      {children}
    </View>
  );
}

function Crumbs({ onEdit }: { onEdit: (text: string) => void }) {
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
      <View testID="omnibox:edit" onPress={search} style={{ flex: 1, height: HEIGHT, minWidth: 24 }} />
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

function Editor({ editing, onDone, onSuggest }: OmniboxProps) {
  const colors = useColors();
  const { store, actions } = useFiles();
  const state = useFilesState();
  const [text, setText] = useState(editing ?? state.query);
  const [highlighted, setHighlighted] = useState(-1);
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const intent = intentOf(text);
  const offered = useMemo(() => (intent === "path" ? completions(text, store.env.home) : []), [intent, text, store.env.home]);

  const go = (target: string): void => {
    const problem = store.goToPath(target);
    if (problem !== null) {
      store.sayPathProblem(problem);
      return;
    }
    onDone();
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: `go`, `text`, and `onSuggest` are read when a pick happens; the list, the highlight, and the place are what change
  useEffect(() => {
    if (bounds === null || offered.length === 0) {
      onSuggest(null);
      return;
    }
    onSuggest({ bounds, items: offered, highlighted, pick: (index) => go(offered[index] ?? text) });
  }, [bounds, offered, highlighted]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: clears the list once, when the editor goes
  useEffect(() => () => onSuggest(null), []);

  const here =
    state.location.kind === "folder" ? (state.location.path === store.env.home ? "Home" : (state.location.path.split("/").at(-1) ?? "")) : "This list";
  return (
    <Field testID="omnibox" onLayout={setBounds}>
      <View style={{ width: 22, alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <Svg markup={intent === "path" ? sidebarGlyph("folder") : SEARCH} size={13} color={colors.textMuted} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <TextInput
          testID="omnibox:text"
          value={text}
          autoFocus={editing !== null}
          placeholder="Search, or type a path"
          onChangeText={(next) => {
            setText(next);
            setHighlighted(-1);
            if (intentOf(next) === "search") store.setQuery(next);
            else if (state.query !== "") store.setQuery("");
          }}
          onSubmitEditing={(typed) => {
            if (intentOf(typed) === "path") go(highlighted >= 0 ? (offered[highlighted] ?? typed) : typed);
            else {
              onDone();
              actions.refocus();
            }
          }}
          onKeyPress={(key) => {
            if (key === "Escape") {
              // Whatever was half typed goes with it: the next edit starts from its own text.
              setText("");
              if (state.query !== "") store.setQuery("");
              onDone();
              actions.refocus();
            } else if (intent === "path" && offered.length > 0) {
              const step = key === "ArrowDown" ? 1 : -1;
              setHighlighted((now) => Math.max(-1, Math.min(offered.length - 1, now + step)));
            } else if (key === "ArrowDown") {
              onDone();
              store.move("down");
              actions.refocus();
            }
          }}
          style={{ fontSize: 13, color: colors.text, placeholderColor: colors.textDisabled }}
        />
      </View>
      {intent === "search" && text.trim() !== "" && (
        <>
          {state.searching && <Text style={{ fontSize: 11, color: colors.textMuted }}>Searching…</Text>}
          <Segmented
            testID="omnibox:scope"
            options={[
              { value: "folder", label: here },
              { value: "computer", label: "Everywhere" },
            ]}
            value={state.scope}
            onChange={(scope) => store.setScope(scope)}
          />
        </>
      )}
      <View
        testID="omnibox:clear"
        onPress={() => {
          if (state.query !== "") store.setQuery("");
          onDone();
          actions.refocus();
        }}
        style={{ width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center", hoverBackgroundColor: colors.button }}
      >
        <Svg markup={CLOSE} size={10} color={colors.textMuted} />
      </View>
    </Field>
  );
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
