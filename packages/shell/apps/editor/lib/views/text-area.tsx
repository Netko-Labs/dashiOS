/**
 * The document's text: one multiline Metal text input in a scroll view, the
 * way Notes' body is. Metal lays a multiline input out at its minimum height
 * and lets the text spill, so a hidden copy of the text measures it and the
 * input is given that height; typing at the end scrolls the view to its end
 * once the layout catches up. Find's jump and Go to Line (`reveal`) measure
 * the text before the place the same way and scroll there.
 *
 * The input has Metal's caret and selection (KB-6), held here as well
 * (`selection`, controlled): the window moves it to Find's match or a line,
 * and it stays where it was when Undo or Replace All change the text. Find's
 * matches are washed behind the text (`highlights`, the current one deeper),
 * and each line's number sits in a gutter at its left (`lineNumbers`); both
 * are drawn by the host beside the laid-out text, never in it. The input is
 * mounted once per document (`session`): mounting it again would put the
 * caret at the end, so the window hands the keyboard back by focusing it
 * (main.tsx), never by remounting it.
 */

import { useColors, useSurface } from "@dashi/ui";
import { ScrollView, Text, type TextHighlight, TextInput, type TextSelection, View } from "@mirinjs/metal";
import { useEffect, useRef, useState } from "react";
import type { EditorPrefs } from "../prefs.ts";

const PADDING = 24;
/** Left of the text with line numbers on: the gutter is room enough. */
const GUTTER_PADDING = 8;

/**
 * The gutter's width for a text of `lines` lines at `fontSize`: room for its
 * longest number (two digits at least) and the gap before the text.
 */
export function gutterWidth(lines: number, fontSize: number): number {
  const digits = Math.max(2, String(Math.max(1, lines)).length);
  return Math.ceil(digits * fontSize * 0.62) + 14;
}

export interface TextAreaProps {
  text: string;
  prefs: EditorPrefs;
  /** How many lines the text has (for the gutter's width). */
  lines: number;
  /** Changes when the input must start over (another document); it takes the keyboard then. */
  session: number;
  /** The caret and selection: as the input last reported it, or where the window moved it. */
  selection: TextSelection;
  onSelectionChange: (selection: TextSelection) => void;
  /** Washed behind the text (Find's matches). */
  highlights: readonly TextHighlight[];
  onChange: (text: string) => void;
  /** Esc in the text (it clears Find). */
  onEscape: () => void;
  /** Scrolls the view: by `dy`, or to its top first when `fromTop`. */
  scroll: (dy: number, fromTop: boolean) => void;
  /** Where the window wants the view; `seq` changes with each jump. */
  reveal: { offset: number; seq: number } | null;
}

const FIELD = { width: "100%", padding: 0, backgroundColor: "#00000000" } as const;

/** Typing at the end keeps the end in view: the view follows it down for a moment after each new line is laid out. */
function useFollowEnd(scroll: TextAreaProps["scroll"]): { following: { current: boolean }; followEnd: () => void } {
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
  return { following, followEnd };
}

export function TextArea({ text, prefs, lines, session, selection, onSelectionChange, highlights, onChange, onEscape, scroll, reveal }: TextAreaProps) {
  const colors = useColors();
  const surface = useSurface();
  const font = prefs.monospace ? ("monospace" as const) : ("default" as const);
  const [height, setHeight] = useState(480);
  const [measured, setMeasured] = useState(0);
  const { following, followEnd } = useFollowEnd(scroll);
  // The place to scroll to: the text before it is measured once laid out.
  const [revealing, setRevealing] = useState<{ offset: number; seq: number } | null>(null);
  useEffect(() => {
    if (reveal) setRevealing(reveal);
  }, [reveal]);

  const textStyle = { fontSize: prefs.fontSize, fontFamily: font };
  const gutter = prefs.lineNumbers ? gutterWidth(lines, prefs.fontSize) : 0;
  const left = prefs.lineNumbers ? GUTTER_PADDING : PADDING;
  return (
    <ScrollView testID="editor" onLayout={(bounds) => setHeight(bounds.height)} style={{ flex: 1, backgroundColor: surface.card }}>
      <View style={{ padding: PADDING, paddingLeft: left, paddingTop: 16, flexDirection: "column", flexShrink: 0, minHeight: height }}>
        <View style={{ position: "relative", flexDirection: "column", flexShrink: 0, width: "100%" }}>
          <View
            testID="text-measure"
            onLayout={(bounds) => {
              setMeasured(bounds.height);
              if (following.current) followEnd();
            }}
            style={{ position: "absolute", left: gutter, top: 0, right: 0, opacity: 0 }}
          >
            <Text style={textStyle}>{text}</Text>
          </View>
          {revealing && (
            <View
              key={`reveal:${revealing.seq}`}
              testID="reveal-measure"
              // Up to the place's line, with a third of the view above it.
              onLayout={(bounds) => {
                scroll(Math.max(0, bounds.height - height / 3), true);
                setRevealing(null);
              }}
              style={{ position: "absolute", left: gutter, top: 0, right: 0, opacity: 0 }}
            >
              <Text style={textStyle}>{text.slice(0, revealing.offset)}</Text>
            </View>
          )}
          <TextInput
            key={`text:${session}`}
            testID="text"
            multiline
            // Tab types a tab here, as in any text editor; Shift+Tab still leaves for the toolbar.
            tabBehavior="insert"
            value={text}
            placeholder="Start typing…"
            autoFocus
            selection={selection}
            highlights={highlights}
            lineNumbers={prefs.lineNumbers ? { width: gutter, color: colors.textMuted } : undefined}
            onChangeText={(next) => {
              if (next.length > text.length && next.startsWith(text)) followEnd();
              onChange(next);
            }}
            onKeyPress={(key) => key === "Escape" && onEscape()}
            onSelectionChange={onSelectionChange}
            style={{
              ...FIELD,
              ...textStyle,
              height: Math.max(200, height - 40, Math.ceil(measured) + 4),
              color: colors.text,
              placeholderColor: colors.textDisabled,
            }}
          />
        </View>
      </View>
    </ScrollView>
  );
}
