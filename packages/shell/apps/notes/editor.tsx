/**
 * The note on the right: when it was edited, the title (the first line), and
 * the body. Edit mode is two Metal text inputs in one scroll view (Metal's
 * input has a caret you move with the arrow keys and Home/End, no pointer
 * placement or selection beyond select-all, and it does not scroll to the
 * caret, so `follow` scrolls the view to its end by itself when text is added
 * at the end). Preview mode draws the Markdown (preview.tsx) and its checklist
 * boxes can be tapped. A deleted note is shown read-only, with Restore.
 */

import { Button, EmptyState, useColors, useSurface } from "@dashi/ui";
import { ScrollView, Text, TextInput, View } from "@mirinjs/metal";
import { useEffect, useRef, useState } from "react";
import { NOTE } from "./glyphs.ts";
import type { Row } from "./list.ts";
import type { Draft } from "./model.ts";
import { Preview } from "./preview.tsx";
import { editedLine } from "./text.ts";

const TITLE_SIZE = 24;
const BODY_SIZE = 14;

export interface EditorProps {
  draft: Draft | null;
  /** The open row, for its date. */
  row: Row | null;
  mode: "edit" | "preview";
  /** Changes when the fields must start over. */
  session: number;
  focusTitle: boolean;
  onEdit: (change: Partial<Draft>) => void;
  onToggleCheck: (line: number) => void;
  /** Esc in a field: give the keyboard back to the list. */
  onLeave: () => void;
  /** After text was added at the end: scroll the view to its end. */
  follow: () => void;
  onRestore: () => void;
  onNew: () => void;
  /** Bumped to hand the keyboard to the body (Enter in the title, Enter in the list). */
  bodyFocus: number;
  onFocusBody: () => void;
  /** Why the list is empty: nothing at all, or just here. */
  emptyMessage: string;
  hasNotes: boolean;
  formatDate: (time: number) => string;
  /** The open note's words, shown after its date. */
  words?: number;
}

export function Editor(props: EditorProps) {
  const {
    draft,
    row,
    mode,
    session,
    focusTitle,
    onEdit,
    onToggleCheck,
    onLeave,
    follow,
    onRestore,
    onNew,
    bodyFocus,
    onFocusBody,
    emptyMessage,
    hasNotes,
    formatDate,
    words,
  } = props;
  const colors = useColors();
  const surface = useSurface();
  const [height, setHeight] = useState(480);
  // The body asks for the keyboard only in the render that bumped `bodyFocus`, not each time it is mounted again.
  const applied = useRef(bodyFocus);
  const wantsFocus = bodyFocus !== applied.current;
  useEffect(() => {
    applied.current = bodyFocus;
  });
  // The body input does not grow with its text (Metal lays a multiline input out at its minimum height and lets the text spill), so the
  // text is measured by a hidden copy and the input given that height. The scroll that follows an append waits for the layout to catch up:
  // before that it would be clamped to the old end.
  const [measured, setMeasured] = useState(0);
  const following = useRef(false);
  const followTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const followEnd = (): void => {
    following.current = true;
    if (followTimer.current) clearTimeout(followTimer.current);
    followTimer.current = setTimeout(follow, 40);
    if (settle.current) clearTimeout(settle.current);
    settle.current = setTimeout(() => {
      following.current = false;
    }, 400);
  };
  useEffect(
    () => () => {
      if (followTimer.current) clearTimeout(followTimer.current);
      if (settle.current) clearTimeout(settle.current);
    },
    [],
  );

  if (row?.deleted) {
    return (
      <View testID="editor" style={{ flex: 1, backgroundColor: surface.card, flexDirection: "column" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 12, paddingHorizontal: 24, backgroundColor: colors.button }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 12, color: colors.textMuted }}>This note is in Recently Deleted. Restore it to edit it.</Text>
          </View>
          <Button label="Restore" testID="restore-banner" primary onPress={onRestore} />
        </View>
        <ScrollView style={{ flex: 1, padding: 28, flexDirection: "column", gap: 14 }}>
          <Text style={{ fontSize: TITLE_SIZE, fontWeight: "bold", color: colors.text }}>{row.title === "" ? "New Note" : row.title}</Text>
          <Preview body={row.body} onToggle={() => {}} />
        </ScrollView>
      </View>
    );
  }

  if (!draft || !row) {
    return (
      <View style={{ flex: 1, backgroundColor: surface.card }}>
        {hasNotes ? (
          <EmptyState testID="no-selection" title="No Note Selected" glyph={NOTE} />
        ) : (
          <EmptyState
            testID="no-notes"
            title="No Notes"
            message={emptyMessage}
            glyph={NOTE}
            action={<Button label="New Note" testID="empty-new" primary onPress={onNew} />}
          />
        )}
      </View>
    );
  }

  const dated = (
    <View style={{ flexShrink: 0 }}>
      <Text style={{ fontSize: 11, color: colors.textMuted, textAlign: "center" }}>{editedLine(formatDate(row.modified), words)}</Text>
    </View>
  );

  if (mode === "preview") {
    return (
      <ScrollView testID="editor" onLayout={(b) => setHeight(b.height)} style={{ flex: 1, backgroundColor: surface.card }}>
        <View style={{ padding: 28, paddingTop: 16, gap: 14, flexDirection: "column", flexShrink: 0, minHeight: height }}>
          {dated}
          <Text style={{ fontSize: TITLE_SIZE, fontWeight: "bold", color: draft.title === "" ? colors.textDisabled : colors.text, lineHeight: TITLE_SIZE + 8 }}>
            {draft.title === "" ? "New Note" : draft.title}
          </Text>
          <Preview body={draft.body} onToggle={onToggleCheck} />
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView testID="editor" onLayout={(b) => setHeight(b.height)} style={{ flex: 1, backgroundColor: surface.card }}>
      <View style={{ padding: 28, paddingTop: 16, gap: 10, flexDirection: "column", flexShrink: 0, minHeight: height }}>
        {dated}
        <View style={{ flexShrink: 0, height: TITLE_SIZE + 12 }}>
          <TextInput
            key={`title:${session}`}
            testID="title"
            value={draft.title}
            placeholder="Title"
            autoFocus={focusTitle}
            onChangeText={(title) => onEdit({ title: title.replace(/\n/g, " ") })}
            onSubmitEditing={onFocusBody}
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
        <View style={{ position: "relative", flexDirection: "column", flexShrink: 0, width: "100%" }}>
          <View
            testID="body-measure"
            onLayout={(bounds) => {
              setMeasured(bounds.height);
              if (following.current) followEnd();
            }}
            style={{ position: "absolute", left: 0, top: 0, right: 0, opacity: 0 }}
          >
            <Text style={{ fontSize: BODY_SIZE }}>{`${draft.body}▏`}</Text>
          </View>
          <TextInput
            key={`body:${session}:${bodyFocus}`}
            testID="body"
            multiline
            value={draft.body}
            placeholder="Start writing…"
            autoFocus={wantsFocus}
            onChangeText={(body) => {
              if (body.length > draft.body.length && body.startsWith(draft.body)) followEnd();
              onEdit({ body });
            }}
            onKeyPress={(key) => key === "Escape" && onLeave()}
            style={{
              width: "100%",
              height: Math.max(200, height - 130, Math.ceil(measured) + 4),
              fontSize: BODY_SIZE,
              padding: 0,
              color: colors.text,
              placeholderColor: colors.textDisabled,
              backgroundColor: "#00000000",
            }}
          />
        </View>
      </View>
    </ScrollView>
  );
}
