/**
 * The one-line field (UI-9): 28 tall at radius 7 on `surface.field`, its
 * words 13 (12.5 in the panel look), a 1 px edge that reads 3:1 which
 * Metal turns into the focus ring's purple while the field has the keyboard,
 * and ume while what it holds is wrong (PA-6). A leading glyph sits over its
 * start, its text clear of it; a line under it says what the field needs, or
 * what is wrong, in ume. Secure for a password. Disabled, it shows its value
 * dimmed and takes no keys. Named for screen readers by `label`, else its
 * placeholder.
 */

import { Svg, Text, TextInput, View } from "@mirinjs/metal";
import type { Look } from "./button-measures.ts";
import { OPACITY, RADIUS, SPACE, TYPE, useColors, useSurface } from "./theme/index.ts";

/** The field's measures (design.html "Text field"). */
export const TEXT_FIELD = { height: 28, padding: SPACE.s, glyph: 15, glyphInset: SPACE.m, glyphGap: SPACE.s, lineGap: SPACE.xs } as const;

export interface TextFieldProps {
  value: string;
  onChangeText: (text: string) => void;
  testID: string;
  placeholder?: string;
  /** What a screen reader calls it, when the placeholder doesn't ("Name"). */
  label?: string;
  /** Pixels; fills the row by default. */
  width?: number;
  autoFocus?: boolean;
  secure?: boolean;
  onSubmit?: (text: string) => void;
  /** Return moves to the next field (a form's line) instead of submitting. */
  focusNextOnSubmit?: boolean;
  onKeyPress?: (key: "Escape" | "ArrowUp" | "ArrowDown") => void;
  /** A glyph over the field's start (a person, a link). */
  glyph?: string;
  /** One line under the field: what it needs, or, with `invalid`, what is wrong. */
  message?: string;
  /** What it holds is wrong: the edge and the line under it are ume. */
  invalid?: boolean;
  disabled?: boolean;
  look?: Look;
}

export function TextField({
  value,
  onChangeText,
  testID,
  placeholder,
  label,
  width,
  autoFocus,
  secure,
  onSubmit,
  focusNextOnSubmit,
  onKeyPress,
  glyph,
  message,
  invalid,
  disabled,
  look = "window",
}: TextFieldProps) {
  const colors = useColors();
  const surface = useSurface();
  const m = TEXT_FIELD;
  const size = look === "panel" ? TYPE.panel.body.size : TYPE.body.size;
  const edge = invalid ? colors.critical : colors.controlEdge;
  const lead = glyph === undefined ? m.padding : m.glyphInset + m.glyph + m.glyphGap;
  const plain = glyph === undefined && (message === undefined || message === "") && !disabled;
  const sizing = plain && width !== undefined ? { width } : { flex: 1 };
  const box = { height: m.height, borderRadius: RADIUS.control, backgroundColor: surface.field } as const;
  const field = disabled ? (
    <ShownValue testID={testID} value={value} placeholder={placeholder} label={label} secure={secure} box={box} lead={lead} size={size} edge={edge} />
  ) : (
    <TextInput
      testID={testID}
      value={value}
      placeholder={placeholder}
      accessibilityLabel={label ?? placeholder}
      autoFocus={autoFocus}
      secureTextEntry={secure}
      onChangeText={onChangeText}
      onSubmitEditing={onSubmit}
      {...(focusNextOnSubmit ? { focusNextOnSubmit: true } : {})}
      onKeyPress={onKeyPress}
      style={{
        ...box,
        ...sizing,
        padding: m.padding,
        ...(glyph === undefined ? {} : { paddingLeft: lead }),
        fontSize: size,
        color: colors.text,
        placeholderColor: colors.textDisabled,
        borderColor: edge,
        focusBorderColor: invalid ? colors.critical : colors.focusRing,
      }}
    />
  );
  // A plain field is the field alone, sized as its row asks: nothing hangs beside it.
  if (plain) return field;
  return (
    <View
      testID={`${testID}:frame`}
      style={{
        ...(width !== undefined ? { width } : { flex: 1 }),
        flexDirection: "column",
        gap: m.lineGap,
        ...(disabled ? { opacity: OPACITY.disabled } : {}),
      }}
    >
      <View style={{ height: m.height, flexDirection: "row", position: "relative" }}>
        {field}
        {glyph !== undefined && (
          <View style={{ position: "absolute", left: m.glyphInset, top: 0, bottom: 0, justifyContent: "center" }}>
            <Svg markup={glyph} size={m.glyph} color={colors.textMuted} />
          </View>
        )}
      </View>
      {message !== undefined && message !== "" && (
        <View testID={`${testID}:message`}>
          <Text style={{ fontSize: TYPE.caption.size, lineHeight: TYPE.caption.line, color: invalid ? colors.ume : colors.textMuted }}>{message}</Text>
        </View>
      )}
    </View>
  );
}

/** A disabled field: its value shown, taking no keys. */
function ShownValue({
  testID,
  value,
  placeholder,
  label,
  secure,
  box,
  lead,
  size,
  edge,
}: {
  testID: string;
  value: string;
  placeholder?: string;
  label?: string;
  secure?: boolean;
  box: { height: number; borderRadius: number; backgroundColor: string };
  lead: number;
  size: number;
  edge: string;
}) {
  const colors = useColors();
  return (
    <View
      testID={testID}
      accessibilityLabel={label ?? placeholder}
      accessibilityState={{ disabled: true }}
      style={{ ...box, flex: 1, justifyContent: "center", paddingLeft: lead, paddingRight: TEXT_FIELD.padding, borderWidth: 1, borderColor: edge }}
    >
      <Text numberOfLines={1} style={{ fontSize: size, color: value === "" ? colors.textDisabled : colors.text }}>
        {value === "" ? (placeholder ?? "") : secure ? "•".repeat(value.length) : value}
      </Text>
    </View>
  );
}
