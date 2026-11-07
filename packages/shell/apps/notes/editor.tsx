/**
 * The note on the right, as one live page: when it was edited, the title
 * (the first line), and the body, a Metal text field that draws its
 * Markdown formatted as it is typed (markup.ts, look.ts). Headings are
 * larger, `**bold**` is bold with its stars faded, a checklist's box is
 * ticked by clicking it, and a link opens with ❖-click (a plain click puts
 * the caret in its words); the file stays the plain Markdown typed. The
 * field has Metal's caret and selection, and the window keeps them
 * (`selection`), so Format, Undo and Find can put the caret back where it
 * belongs. Metal lays a multiline field out at its minimum height, so a
 * hidden copy of the text, each line at its size, measures it; typing at
 * the end scrolls the view to its end once the layout catches up. A deleted
 * note is the same page, read-only, with Restore.
 */

import { Button, EmptyState, useColors, useSurface } from "@dashi/ui";
import { ScrollView, Text, TextInput, View } from "@mirinjs/metal";
import { useEffect, useMemo, useRef, useState } from "react";
import { findMatches } from "./find.ts";
import type { Selection } from "./format.ts";
import { NOTE } from "./glyphs.ts";
import type { Row } from "./list.ts";
import { BODY_SIZE, lineSizes, lookOf, type Pressable, TITLE_SIZE } from "./look.ts";
import { markup } from "./markup.ts";
import type { Draft } from "./model.ts";
import { untitled } from "./names.ts";
import { editedLine } from "./text.ts";

export interface EditorProps {
  draft: Draft | null;
  /** The open row, for its date. */
  row: Row | null;
  /** The body's caret and selection. */
  selection: Selection;
  /** The search, whose words are washed in the body (Find). */
  query: string;
  /** Changes when the fields must start over. */
  session: number;
  focusTitle: boolean;
  onEdit: (change: Partial<Draft>) => void;
  onSelection: (selection: Selection) => void;
  onToggleCheck: (line: number) => void;
  /** ❖-click on a link. */
  onOpenLink: (url: string) => void;
  /** Esc in a field: give the keyboard back to the list. */
  onLeave: () => void;
  /** After text was added at the end: scroll the view to its end. */
  follow: () => void;
  onRestore: () => void;
  onNew: () => void;
  /** Bumped to hand the keyboard to the body (Enter in the list, Find Next, a format command); the title's Return moves it in the host. */
  bodyFocus: number;
  /** What the page says when the list is empty: nothing at all, nothing here, no matches. */
  empty: { title: string; message: string; canCreate: boolean };
  hasNotes: boolean;
  formatDate: (time: number) => string;
  /** The open note's words, shown after its date. */
  words?: number;
}

/** The body: the live Markdown field, with the copy that measures it. */
function Page({
  body,
  selection,
  query,
  fieldKey,
  wantsFocus,
  minHeight,
  readOnly,
  onChange,
  onSelection,
  onPress,
  onLeave,
  onMeasured,
}: {
  body: string;
  selection: Selection;
  query: string;
  fieldKey: string;
  wantsFocus: boolean;
  minHeight: number;
  readOnly: boolean;
  onChange: (body: string) => void;
  onSelection: (selection: Selection) => void;
  onPress: (span: Pressable, offset: number, modified: boolean) => void;
  onLeave: () => void;
  onMeasured: () => void;
}) {
  const colors = useColors();
  const [measured, setMeasured] = useState(0);
  // A read-only page takes no typing: the field is given its text back.
  const [refused, setRefused] = useState(0);
  const look = useMemo(() => lookOf(markup(body), colors, findMatches(body, query)), [body, colors, query]);
  const lines = useMemo(() => lineSizes(body), [body]);
  return (
    <View style={{ position: "relative", flexDirection: "column", flexShrink: 0, width: "100%" }}>
      <View
        testID="body-measure"
        onLayout={(bounds) => {
          setMeasured(bounds.height);
          onMeasured();
        }}
        style={{ position: "absolute", left: 0, top: 0, right: 0, opacity: 0, flexDirection: "column" }}
      >
        {lines.map((line, index) => (
          // Lines have no identity beyond their place; the copy is laid out whole on every change.
          <Text key={index} style={{ fontSize: line.size, fontWeight: line.size === BODY_SIZE ? "normal" : "bold" }}>
            {line.text === "" ? " " : line.text}
          </Text>
        ))}
      </View>
      <TextInput
        key={fieldKey}
        testID="body"
        multiline
        value={body}
        valueRevision={refused}
        placeholder={readOnly ? "" : "Start writing…"}
        autoFocus={wantsFocus}
        selection={selection}
        runs={look.runs}
        onChangeText={(next) => (readOnly ? setRefused((n) => n + 1) : onChange(next))}
        onSelectionChange={onSelection}
        onRunPress={(event) => {
          const span = look.pressable.get(event.run);
          if (span) onPress(span, event.offset, event.modifiers.control || event.modifiers.super);
        }}
        onKeyPress={(key) => key === "Escape" && onLeave()}
        style={{
          width: "100%",
          height: Math.max(minHeight, Math.ceil(measured) + 4),
          fontSize: BODY_SIZE,
          padding: 0,
          color: colors.text,
          placeholderColor: colors.textDisabled,
          backgroundColor: "#00000000",
        }}
      />
    </View>
  );
}

export function Editor(props: EditorProps) {
  const { draft, row, selection, query, session, focusTitle, onEdit, onLeave, follow, onRestore, onNew, bodyFocus, empty, hasNotes, formatDate, words } = props;
  const colors = useColors();
  const surface = useSurface();
  const [height, setHeight] = useState(480);
  // The body asks for the keyboard only in the render that bumped `bodyFocus`, not each time it is mounted again.
  const applied = useRef(bodyFocus);
  const wantsFocus = bodyFocus !== applied.current;
  useEffect(() => {
    applied.current = bodyFocus;
  });
  // The scroll that follows an append waits for the layout to catch up: before that it would be clamped to the old end.
  const following = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const followEnd = (): void => {
    following.current = true;
    timers.current.push(setTimeout(follow, 40));
    timers.current.push(
      setTimeout(() => {
        following.current = false;
      }, 400),
    );
  };
  useEffect(
    () => () => {
      for (const timer of timers.current) clearTimeout(timer);
    },
    [],
  );

  const press = (span: Pressable, offset: number, modified: boolean): void => {
    if (span.kind === "box") return props.onToggleCheck(span.line);
    // A link's words are text like any other: a plain click puts the caret there; ❖-click opens it.
    if (modified) props.onOpenLink(span.url);
    else props.onSelection({ start: offset, end: offset });
  };

  if (row?.deleted) {
    return (
      <View testID="editor" style={{ flex: 1, backgroundColor: surface.card, flexDirection: "column" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 12, paddingHorizontal: 24, backgroundColor: colors.button }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 12, color: colors.textMuted }}>This note is in Recently Deleted. Restore it to edit it.</Text>
          </View>
          <Button label="Restore" testID="restore-banner" primary onPress={onRestore} />
        </View>
        <ScrollView style={{ flex: 1, padding: 28, flexDirection: "column", gap: 10 }}>
          <Text style={{ fontSize: TITLE_SIZE, fontWeight: "bold", color: colors.text }}>{untitled(row.title)}</Text>
          <Page
            body={row.body}
            selection={{ start: 0, end: 0 }}
            query={query}
            fieldKey={`deleted:${row.id}`}
            wantsFocus={false}
            minHeight={0}
            readOnly
            onChange={() => {}}
            onSelection={() => {}}
            onPress={() => {}}
            onLeave={onLeave}
            onMeasured={() => {}}
          />
        </ScrollView>
      </View>
    );
  }

  if (!draft || !row) {
    return (
      <View style={{ flex: 1, backgroundColor: surface.card }}>
        {hasNotes ? (
          <EmptyState testID="no-selection" title="No note open" message="Choose one from the list, or make a new one." glyph={NOTE} />
        ) : (
          <EmptyState
            testID="no-notes"
            title={empty.title}
            message={empty.message}
            glyph={NOTE}
            {...(empty.canCreate ? { action: <Button label="New note" testID="empty-new" primary onPress={onNew} /> } : {})}
          />
        )}
      </View>
    );
  }

  return (
    <ScrollView testID="editor" onLayout={(b) => setHeight(b.height)} style={{ flex: 1, backgroundColor: surface.card }}>
      <View style={{ padding: 28, paddingTop: 16, gap: 10, flexDirection: "column", flexShrink: 0, minHeight: height }}>
        <View style={{ flexShrink: 0 }}>
          <Text style={{ fontSize: 11, color: colors.textMuted, textAlign: "center" }}>{editedLine(formatDate(row.modified), words)}</Text>
        </View>
        <View style={{ flexShrink: 0, height: TITLE_SIZE + 12 }}>
          <TextInput
            key={`title:${session}`}
            testID="title"
            value={draft.title}
            placeholder="Title"
            autoFocus={focusTitle}
            onChangeText={(title) => onEdit({ title: title.replace(/\n/g, " ") })}
            // Return hands the keyboard to the body in the host, before the app hears of it:
            // what is typed right after is the body's, however fast it comes.
            focusNextOnSubmit
            onKeyPress={(key) => key === "Escape" && onLeave()}
            style={{
              height: TITLE_SIZE + 12,
              fontSize: TITLE_SIZE,
              padding: 0,
              color: colors.text,
              placeholderColor: colors.textDisabled,
              backgroundColor: "#00000000",
            }}
          />
        </View>
        <Page
          body={draft.body}
          selection={selection}
          query={query}
          fieldKey={`body:${session}:${bodyFocus}`}
          wantsFocus={wantsFocus}
          minHeight={Math.max(200, height - 130)}
          readOnly={false}
          onChange={(body) => {
            if (body.length > draft.body.length && body.startsWith(draft.body)) followEnd();
            onEdit({ body });
          }}
          onSelection={props.onSelection}
          onPress={press}
          onLeave={onLeave}
          onMeasured={() => {
            if (following.current) followEnd();
          }}
        />
      </View>
    </ScrollView>
  );
}
