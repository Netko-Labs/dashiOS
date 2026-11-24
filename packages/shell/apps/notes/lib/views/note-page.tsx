/**
 * The pieces of a note's page over its body (body.tsx): the line over it
 * and its title.
 */

import { EditableText, type Palette, SPACE, TYPE } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { useState } from "react";
import { TITLE_SIZE } from "../sizes.ts";

/** The page's inset: the note's words, its title and the line over it share one left edge. */
export const GUTTER = 28;

/** The line over the note: one line, centred, muted. */
export function MetaLine({ text, colors }: { text: string; colors: Palette }) {
  return (
    <View testID="meta" style={{ flexShrink: 0 }}>
      <Text numberOfLines={1} style={{ fontSize: TYPE.caption.size, color: colors.textMuted, textAlign: "center" }}>
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
  onCaret,
}: {
  value: string;
  fieldKey: string;
  autoFocus: boolean;
  readOnly: boolean;
  onChange: (title: string) => void;
  onLeave: () => void;
  /** The title has the caret (a click, a key): the body is not being edited. */
  onCaret?: () => void;
}) {
  const [measured, setMeasured] = useState(0);
  const [refused, setRefused] = useState(0);
  const height = Math.max(TITLE_SIZE + SPACE.inset, Math.ceil(measured) + SPACE.xs);
  return (
    <View style={{ position: "relative", flexShrink: 0, width: "100%", height }}>
      <View
        testID="title-measure"
        onLayout={(bounds) => setMeasured(bounds.height)}
        style={{ position: "absolute", left: 0, top: 0, right: 0, opacity: 0, flexDirection: "column" }}
      >
        <Text style={{ fontSize: TITLE_SIZE }}>{value === "" ? " " : value}</Text>
      </View>
      <EditableText
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
        {...(onCaret ? { onSelectionChange: onCaret } : {})}
        style={{
          width: "100%",
          height,
          fontSize: TITLE_SIZE,
          padding: 0,
        }}
      />
    </View>
  );
}
