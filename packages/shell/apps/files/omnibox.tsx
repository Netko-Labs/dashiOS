/**
 * The omnibox: the toolbar's one field for where you are and what you look
 * for. At rest it is the path as crumbs (click one to go there; drop files on
 * one to move them there) and, at its end, the folder's status line. A click
 * on its empty part, ⌘L, or Go to Folder… makes it text: a path (`/`, `~`)
 * goes there, with its subfolders offered under it (↑↓ to pick, Enter to
 * go); anything else searches as you type, the results in the listing, a
 * chip choosing this folder or the whole computer. Escape gives the crumbs
 * back.
 */

import { rowLook, SEARCH, SelectionBar, useColors } from "@dashi/ui";
import { type Bounds, Svg, Text, TextInput, View } from "@mirinjs/metal";
import { useEffect, useMemo, useState } from "react";
import { useFiles, useFilesState } from "./context.ts";
import { useDropTarget } from "./drop.ts";
import { statusLine } from "./footer.tsx";
import { CHEVRON, CLOSE, sidebarGlyph } from "./glyphs.ts";
import { type Location, pathSegments } from "./location.ts";
import { completions, displayPath, intentOf } from "./omnibox.ts";

const HEIGHT = 28;

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
  return <Editor key={props.editing ?? "query"} {...props} />;
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
      {...(onPress ? { focusable: true, onPress, accessibilityRole: "button" as const, accessibilityLabel: "Path. Press to type a path or search" } : {})}
      style={{
        flex: 1,
        minWidth: 160,
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
  const edit = (): void => onEdit(editText(state.location, store.env.home));
  return (
    <Field testID="omnibox" onPress={edit}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 0, minWidth: 0, flexShrink: 1, overflow: "hidden" }}>
        {segments.map((segment, index) => (
          <Crumb key={`${index}:${segment.name}`} index={index} name={segment.name} location={segment.location} last={index === segments.length - 1} />
        ))}
      </View>
      <View testID="omnibox:edit" onPress={edit} style={{ flex: 1, height: HEIGHT, minWidth: 24 }} />
      <View testID="status" style={{ flexShrink: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 11, color: colors.textMuted }}>
          {statusLine(visible.length, picked, state.free?.free ?? null)}
        </Text>
      </View>
    </Field>
  );
}

function Crumb({ index, name, location, last }: { index: number; name: string; location: Location; last: boolean }) {
  const colors = useColors();
  const { store } = useFiles();
  const drop = useDropTarget(location.kind === "folder" ? location.path : location.kind === "trash" ? "trash" : null);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", flexShrink: last ? 1 : 0, minWidth: 0 }}>
      {index > 0 && <Svg markup={CHEVRON} size={10} color={colors.textDisabled} />}
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
      store.say(problem, true);
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

  const scopeLabel =
    state.scope === "computer"
      ? "Everywhere"
      : state.location.kind === "folder"
        ? `In ${state.location.path === store.env.home ? "Home" : (state.location.path.split("/").at(-1) ?? "")}`
        : "In this list";
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
              if (state.query !== "") store.setQuery("");
              onDone();
              actions.refocus();
            } else if (intent === "path" && offered.length > 0) {
              const step = key === "ArrowDown" ? 1 : -1;
              setHighlighted((now) => Math.max(-1, Math.min(offered.length - 1, now + step)));
            } else if (key === "ArrowDown") {
              onDone();
              store.move(1);
              actions.refocus();
            }
          }}
          style={{ fontSize: 13, color: colors.text, placeholderColor: colors.textDisabled }}
        />
      </View>
      {intent === "search" && text.trim() !== "" && (
        <>
          {state.searching && <Text style={{ fontSize: 11, color: colors.textMuted }}>Searching…</Text>}
          <View
            testID="omnibox:scope"
            onPress={() => store.setScope(state.scope === "computer" ? "folder" : "computer")}
            style={{
              height: 20,
              paddingHorizontal: 8,
              borderRadius: 10,
              justifyContent: "center",
              borderWidth: 1,
              borderColor: colors.separator,
              hoverBackgroundColor: colors.button,
            }}
          >
            <Text numberOfLines={1} style={{ fontSize: 11, color: colors.text }}>
              {scopeLabel}
            </Text>
          </View>
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
