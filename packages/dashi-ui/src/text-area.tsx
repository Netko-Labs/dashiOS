/**
 * The many-line field (UI-9's twin): a text field's edge, ground and focus,
 * for words that run to several lines (an event's notes, a text a dialog lets
 * the person edit). Radius 7 on `surface.field`, a 1 px edge that reads 3:1,
 * which Metal turns into the focus ring's purple while it has the keyboard;
 * its words 13 (12 `small`, 12.5 in the panel look), padded as a field's. It
 * fills the room its column gives it, or stands `height` tall. Named for
 * screen readers by `label`, else its placeholder.
 */

import { TextInput } from "@mirinjs/metal";
import type { Look } from "./button-measures.ts";
import { RADIUS, SPACE, TYPE, useColors, useSurface } from "./theme/index.ts";

/** The area's measures: a field's padding (TEXT_FIELD) and the least height of two lines and their padding. */
export const TEXT_AREA = { padding: SPACE.s, least: 2 * TYPE.body.line + 2 * SPACE.s } as const;

export interface TextAreaProps {
  value: string;
  onChangeText: (text: string) => void;
  testID: string;
  placeholder?: string;
  /** What a screen reader calls it, when the placeholder doesn't ("Notes"). */
  label?: string;
  /** Pixels; by default it fills its column's height. */
  height?: number;
  autoFocus?: boolean;
  onKeyPress?: (key: "Escape" | "ArrowUp" | "ArrowDown") => void;
  /** ⌃↩ (and ❖↩) sends; Return stays a new line. */
  onSubmit?: () => void;
  /** Secondary words (12): a file's text in a dialog. */
  small?: boolean;
  look?: Look;
}

export function TextArea({ value, onChangeText, testID, placeholder, label, height, autoFocus, onKeyPress, onSubmit, small, look = "window" }: TextAreaProps) {
  const colors = useColors();
  const surface = useSurface();
  const role = look === "panel" ? TYPE.panel.body : small ? TYPE.secondary : TYPE.body;
  return (
    <TextInput
      testID={testID}
      value={value}
      multiline
      placeholder={placeholder}
      accessibilityLabel={label ?? placeholder}
      autoFocus={autoFocus}
      onChangeText={onChangeText}
      onKeyPress={onKeyPress}
      {...(onSubmit ? { submitBehavior: "newline" as const, onSubmitEditing: onSubmit } : {})}
      style={{
        ...(height !== undefined ? { height } : { flex: 1, minHeight: TEXT_AREA.least }),
        borderRadius: RADIUS.control,
        backgroundColor: surface.field,
        padding: TEXT_AREA.padding,
        fontSize: role.size,
        color: colors.text,
        placeholderColor: colors.textDisabled,
        borderColor: colors.controlEdge,
        focusBorderColor: colors.focusRing,
      }}
    />
  );
}
