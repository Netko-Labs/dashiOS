/**
 * A field drawn in place on what it names (UI-9's in-place form): a new
 * event's title typed on its block in Calendar's grid. No box and no ground:
 * the thing it sits on is its frame. While it has the keyboard a 1 px
 * `focusRing` edge shows it (KB-2); at rest, nothing but its words. One line;
 * Return submits, Esc goes to `onKeyPress`. Named for screen readers by
 * `label`, else its placeholder.
 */

import { TextInput } from "@mirinjs/metal";
import { CLEAR, TYPE, useColors } from "./theme/index.ts";

export interface InlineFieldProps {
  value: string;
  onChangeText: (text: string) => void;
  testID: string;
  placeholder?: string;
  label?: string;
  autoFocus?: boolean;
  onSubmit?: (text: string) => void;
  onKeyPress?: (key: "Escape" | "ArrowUp" | "ArrowDown") => void;
  /** Its words: `caption` (11) on a grid's block, `body` (13) elsewhere. */
  size?: "caption" | "body";
  /** Pixels; the line its words sit on, by default. */
  height?: number;
}

export function InlineField({ value, onChangeText, testID, placeholder, label, autoFocus, onSubmit, onKeyPress, size = "body", height }: InlineFieldProps) {
  const colors = useColors();
  const role = TYPE[size];
  return (
    <TextInput
      testID={testID}
      value={value}
      placeholder={placeholder}
      accessibilityLabel={label ?? placeholder}
      autoFocus={autoFocus}
      onChangeText={onChangeText}
      onSubmitEditing={onSubmit}
      onKeyPress={onKeyPress}
      style={{
        width: "100%",
        height: height ?? role.line,
        fontSize: role.size,
        padding: 0,
        color: colors.text,
        placeholderColor: colors.textMuted,
        backgroundColor: CLEAR,
        borderColor: CLEAR,
        focusBorderColor: colors.focusRing,
      }}
    />
  );
}
