/**
 * The pieces of a note's page: the line over it, its title, and its body, a
 * live Markdown field with the hidden copy that measures it.
 */

import { type Palette, useColors } from "@dashi/ui";
import { Text, TextInput, View } from "@mirinjs/metal";
import { useMemo, useState } from "react";
import { findMatches } from "./find.ts";
import type { Selection } from "./format.ts";
import { BODY_SIZE, lineSizes, lookOf, type Pressable, TITLE_SIZE } from "./look.ts";
import { markup } from "./markup.ts";

/** The page's inset: the note's words, its title and the line over it share one left edge. */
export const GUTTER = 28;

/** The line over the note: one line, centred, muted. */
export function MetaLine({ text, colors }: { text: string; colors: Palette }) {
  return (
    <View testID="meta" style={{ flexShrink: 0 }}>
      <Text numberOfLines={1} style={{ fontSize: 11, color: colors.textMuted, textAlign: "center" }}>
        {text}
      </Text>
    </View>
  );
}

/** The title: it wraps as the body does (a hidden copy measures it), and Return hands the keyboard to the body. */
export function Title({
  value,
  fieldKey,
  autoFocus,
  readOnly,
  onChange,
  onLeave,
}: {
  value: string;
  fieldKey: string;
  autoFocus: boolean;
  readOnly: boolean;
  onChange: (title: string) => void;
  onLeave: () => void;
}) {
  const colors = useColors();
  const [measured, setMeasured] = useState(0);
  const [refused, setRefused] = useState(0);
  const height = Math.max(TITLE_SIZE + 12, Math.ceil(measured) + 4);
  return (
    <View style={{ position: "relative", flexShrink: 0, width: "100%", height }}>
      <View
        testID="title-measure"
        onLayout={(bounds) => setMeasured(bounds.height)}
        style={{ position: "absolute", left: 0, top: 0, right: 0, opacity: 0, flexDirection: "column" }}
      >
        <Text style={{ fontSize: TITLE_SIZE }}>{value === "" ? " " : value}</Text>
      </View>
      <TextInput
        key={fieldKey}
        testID="title"
        multiline
        // One paragraph that wraps: Return submits, and the host hands the keyboard to the body
        // before the app hears of it, so what is typed right after is the body's, however fast.
        submitBehavior="submit"
        focusNextOnSubmit
        value={value}
        valueRevision={refused}
        placeholder={readOnly ? "" : "Title"}
        autoFocus={autoFocus}
        onChangeText={(title) => (readOnly ? setRefused((n) => n + 1) : onChange(title.replace(/\n/g, " ")))}
        onKeyPress={(key) => key === "Escape" && onLeave()}
        style={{
          width: "100%",
          height,
          fontSize: TITLE_SIZE,
          padding: 0,
          color: colors.text,
          placeholderColor: colors.textDisabled,
          backgroundColor: "#00000000",
        }}
      />
    </View>
  );
}

/** The body: the live Markdown field, with the copy that measures it. */
export function Page({
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
