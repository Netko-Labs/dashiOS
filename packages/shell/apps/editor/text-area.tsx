/**
 * The document's text: one multiline Metal text input in a scroll view, the
 * way Notes' body is. Metal lays a multiline input out at its minimum height
 * and lets the text spill, so a hidden copy of the text measures it and the
 * input is given that height; typing at the end scrolls the view to its end
 * once the layout catches up. Find's jump (`reveal`) measures the text before
 * the match the same way and scrolls there. The input has Metal's caret and
 * selection: a click places the caret; a drag, a double or triple click, and
 * ⇧ with the arrows select; and the window hears whether anything is
 * selected (`onSelectionChange`, for Cut and Copy). The input is mounted once per
 * document (`session`): mounting it again would put the caret at the end, so
 * the window hands the keyboard back by focusing it (main.tsx), never by
 * remounting it.
 */

import { useColors, useSurface } from "@dashi/ui";
import { ScrollView, Text, TextInput, View } from "@mirinjs/metal";
import { useEffect, useRef, useState } from "react";
import type { EditorPrefs } from "./prefs.ts";

const PADDING = 24;

export interface TextAreaProps {
  text: string;
  prefs: EditorPrefs;
  /** Changes when the input must start over (another document); it takes the keyboard then. */
  session: number;
  onChange: (text: string) => void;
  /** Esc in the text (it clears Find). */
  onEscape: () => void;
  /** Whether text is selected, each time that changes. */
  onSelectionChange: (selected: boolean) => void;
  /** Scrolls the view: by `dy`, or to its top first when `fromTop`. */
  scroll: (dy: number, fromTop: boolean) => void;
  /** Where Find wants the view; `seq` changes with each jump. */
  reveal: { offset: number; seq: number } | null;
}

export function TextArea({ text, prefs, session, onChange, onEscape, onSelectionChange, scroll, reveal }: TextAreaProps) {
  const colors = useColors();
  const surface = useSurface();
  const font = prefs.monospace ? ("monospace" as const) : ("default" as const);
  const [height, setHeight] = useState(480);
  const [measured, setMeasured] = useState(0);
  const following = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const later = (fn: () => void, ms: number): void => {
    timers.current.push(setTimeout(fn, ms));
  };
  useEffect(
    () => () => {
      for (const timer of timers.current) clearTimeout(timer);
    },
    [],
  );
  const followEnd = (): void => {
    following.current = true;
    later(() => scroll(10_000_000, false), 40);
    later(() => {
      following.current = false;
    }, 400);
  };
  // The match to scroll to: its text before it is measured once laid out.
  const [revealing, setRevealing] = useState<{ offset: number; seq: number } | null>(null);
  useEffect(() => {
    if (reveal) setRevealing(reveal);
  }, [reveal]);

  const textStyle = { fontSize: prefs.fontSize, fontFamily: font };
  return (
    <ScrollView testID="editor" onLayout={(bounds) => setHeight(bounds.height)} style={{ flex: 1, backgroundColor: surface.card }}>
      <View style={{ padding: PADDING, paddingTop: 16, flexDirection: "column", flexShrink: 0, minHeight: height }}>
        <View style={{ position: "relative", flexDirection: "column", flexShrink: 0, width: "100%" }}>
          <View
            testID="text-measure"
            onLayout={(bounds) => {
              setMeasured(bounds.height);
              if (following.current) followEnd();
            }}
            style={{ position: "absolute", left: 0, top: 0, right: 0, opacity: 0 }}
          >
            <Text style={textStyle}>{`${text}▏`}</Text>
          </View>
          {revealing && (
            <View
              key={`reveal:${revealing.seq}`}
              testID="reveal-measure"
              onLayout={(bounds) => {
                // Up to the match's line, with a third of the view above it.
                scroll(Math.max(0, bounds.height - height / 3), true);
                setRevealing(null);
              }}
              style={{ position: "absolute", left: 0, top: 0, right: 0, opacity: 0 }}
            >
              <Text style={textStyle}>{`${text.slice(0, revealing.offset)}▏`}</Text>
            </View>
          )}
          <TextInput
            key={`text:${session}`}
            testID="text"
            multiline
            value={text}
            placeholder="Start typing…"
            autoFocus
            onChangeText={(next) => {
              if (next.length > text.length && next.startsWith(text)) followEnd();
              onChange(next);
            }}
            onKeyPress={(key) => key === "Escape" && onEscape()}
            onSelectionChange={(selection) => onSelectionChange(selection.start !== selection.end)}
            style={{
              width: "100%",
              height: Math.max(200, height - 40, Math.ceil(measured) + 4),
              fontSize: prefs.fontSize,
              fontFamily: font,
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
