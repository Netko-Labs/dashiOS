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
 * hidden copy of the text, each line at its size, measures it (the title's
 * too: it wraps, and Return still hands the keyboard to the body); typing at
 * the end scrolls the view to its end once the layout catches up. The line
 * over the note says its date in the longest form that fits on one line. A
 * deleted note is the same page in the same place and weight, read-only; the
 * line over it says it is deleted, and the toolbar has Restore.
 */

import { Button, EmptyState, useColors, useSurface } from "@dashi/ui";
import { ScrollView, View } from "@mirinjs/metal";
import { useEffect, useRef, useState } from "react";
import { untitled } from "../../../../src/shared/notes/names.ts";
import { KEEP_DAYS } from "../../../../src/shared/notes/store.ts";
import { daysLeft, editedLine } from "../../../../src/shared/notes/text.ts";
import type { Selection } from "../format.ts";
import { NOTE } from "../glyphs.ts";
import { type DateForm, fitLine } from "../layout.ts";
import type { Row } from "../list.ts";
import type { Pressable } from "../look.ts";
import type { Draft } from "../state.ts";
import { GUTTER, MetaLine, Page, Title } from "./note-page.tsx";

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
  onNew: () => void;
  /** Bumped to hand the keyboard to the body (Enter in the list, Find Next, a format command); the title's Return moves it in the host. */
  bodyFocus: number;
  /** What the page says when the list is empty: nothing at all, nothing here, no matches. */
  empty: { title: string; message: string; canCreate: boolean };
  hasNotes: boolean;
  /** A date in one of its forms, for the line over the note. */
  formatDate: (time: number, form: DateForm) => string;
  /** The open note's words, shown after its date. */
  words?: number;
  /** Now, for a deleted note's days left. */
  now: number;
}

const DATE_FORMS: readonly DateForm[] = ["long", "medium", "short"];

/** The scroll that follows an append waits for the layout to catch up: before that it would be clamped to the old end. */
function useFollowEnd(follow: () => void): { followEnd: () => void; following: { current: boolean } } {
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
  return { followEnd, following };
}

/** A deleted note: the same page in the same place and weight, read-only, with the days it has left. */
function DeletedNote({
  row,
  query,
  now,
  room,
  height,
  onLeave,
  measure,
}: {
  row: Row;
  query: string;
  now: number;
  room: number;
  height: number;
  onLeave: () => void;
  measure: (bounds: { width: number; height: number }) => void;
}) {
  const colors = useColors();
  const surface = useSurface();
  const days = daysLeft(row.deletedAt, now, KEEP_DAYS);
  const left = `${days} ${days === 1 ? "day" : "days"} left`;
  return (
    <ScrollView testID="editor" onLayout={measure} style={{ flex: 1, backgroundColor: surface.card }}>
      <View style={{ padding: GUTTER, paddingTop: 16, gap: 10, flexDirection: "column", flexShrink: 0, minHeight: height }}>
        <MetaLine text={fitLine(room, [`In Recently Deleted · ${left} · Restore it to edit it`, `In Recently Deleted · ${left}`, left])} colors={colors} />
        <Title value={untitled(row.title)} fieldKey={`deleted-title:${row.id}`} autoFocus={false} readOnly onChange={() => {}} onLeave={onLeave} />
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
      </View>
    </ScrollView>
  );
}

/** No note is open: the list is empty, or none is chosen. */
function NoNote({ props }: { props: EditorProps }) {
  const surface = useSurface();
  const { empty, hasNotes, onNew } = props;
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

export function Editor(props: EditorProps) {
  const { draft, row, selection, query, session, focusTitle, onEdit, onLeave, follow, bodyFocus, formatDate, words, now } = props;
  const colors = useColors();
  const surface = useSurface();
  const [height, setHeight] = useState(480);
  const [width, setWidth] = useState(0);
  const room = width > 0 ? width - 2 * GUTTER : Number.POSITIVE_INFINITY;
  const measure = (bounds: { width: number; height: number }): void => {
    setHeight(bounds.height);
    setWidth(bounds.width);
  };
  // The body asks for the keyboard only in the render that bumped `bodyFocus`, not each time it is mounted again.
  const applied = useRef(bodyFocus);
  const wantsFocus = bodyFocus !== applied.current;
  useEffect(() => {
    applied.current = bodyFocus;
  });
  const { followEnd, following } = useFollowEnd(follow);

  const press = (span: Pressable, offset: number, modified: boolean): void => {
    if (span.kind === "box") return props.onToggleCheck(span.line);
    // A link's words are text like any other: a plain click puts the caret there; ❖-click opens it.
    if (modified) props.onOpenLink(span.url);
    else props.onSelection({ start: offset, end: offset });
  };

  if (row?.deleted) return <DeletedNote row={row} query={query} now={now} room={room} height={height} onLeave={onLeave} measure={measure} />;
  if (!draft || !row) return <NoNote props={props} />;

  return (
    <ScrollView testID="editor" onLayout={measure} style={{ flex: 1, backgroundColor: surface.card }}>
      <View style={{ padding: GUTTER, paddingTop: 16, gap: 10, flexDirection: "column", flexShrink: 0, minHeight: height }}>
        <MetaLine
          text={fitLine(
            room,
            DATE_FORMS.map((form) => editedLine(formatDate(row.modified, form), words)),
          )}
          colors={colors}
        />
        <Title
          value={draft.title}
          fieldKey={`title:${session}`}
          autoFocus={focusTitle}
          readOnly={false}
          onChange={(title) => onEdit({ title })}
          onLeave={onLeave}
        />
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
