/**
 * Words edited where they are shown (UI-9's sibling, 0.10): a document's
 * text (Text Editor's page, a note's body and title), Calculator's line, a
 * name being renamed in place. It is mirin's field with the kit's look, so
 * no app draws a bare `TextInput`: `plain` has no ground and no edge (the
 * words sit on the page they belong to), `inline` is the rename look, the
 * card's ground inside a 1 px edge in the focus ring's colour at radius 4,
 * since the name is being edited the moment it shows. The caret, the
 * selection (`TextSelectionLook`) and the keys (KB-6) are the field's own.
 * A one-line field with a box of its own is `TextField`; a filter or a Find
 * is `SearchField`.
 */

import { TextInput, type TextInputProps, type TextInputStyle } from "@mirinjs/metal";
import { CLEAR, RADIUS, SPACE, TYPE, useColors, useSurface } from "./theme/index.ts";

/** The inline look's measures: a rename in an icon view or a list. */
export const EDITABLE_TEXT = { inlineHeight: 20, inlinePadding: SPACE.xxs, inlineRadius: RADIUS.check, inlineSize: TYPE.secondary.size } as const;

/** What a caller may set: where it sits and its words' type. Its ground and edge are the look's. */
export type EditableTextStyle = Omit<TextInputStyle, "backgroundColor" | "borderColor" | "focusBorderColor" | "borderRadius">;

export interface EditableTextProps extends Omit<TextInputProps, "style"> {
  testID: string;
  /** `plain` (default): on the page, no ground, no edge. `inline`: a rename in place. */
  look?: "plain" | "inline";
  style?: EditableTextStyle;
}

export function EditableText({ look = "plain", style, ...field }: EditableTextProps) {
  const colors = useColors();
  const surface = useSurface();
  const inline = look === "inline";
  const ground = inline
    ? {
        height: EDITABLE_TEXT.inlineHeight,
        padding: EDITABLE_TEXT.inlinePadding,
        fontSize: EDITABLE_TEXT.inlineSize,
        borderRadius: EDITABLE_TEXT.inlineRadius,
        backgroundColor: surface.card,
        borderColor: colors.focusRing,
        focusBorderColor: colors.focusRing,
      }
    : { backgroundColor: CLEAR, borderColor: CLEAR, focusBorderColor: CLEAR };
  return <TextInput {...field} style={{ color: colors.text, placeholderColor: colors.textDisabled, ...style, ...ground }} />;
}
