/**
 * Fields and pickers beyond the grouped-row controls (controls.tsx): a segmented control,
 * a text field, and a search field. They paint with the live palette.
 */

import { Svg, Text, TextInput, View } from "@mirinjs/metal";
import { useControlState } from "./control-state.tsx";
import type { Choice } from "./controls.tsx";
import { CLEAR, SEARCH } from "./glyphs.ts";
import { useColors, useSurface } from "./theme/index.ts";

/** macOS's segmented control: a sunk track, the chosen segment raised on it. */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  testID,
  segmentWidth,
  disabled,
  focused,
}: {
  options: ReadonlyArray<Choice<T>>;
  value: T;
  onChange: (value: T) => void;
  testID: string;
  /** Every segment this wide; by default each fits its label. */
  segmentWidth?: number;
  disabled?: boolean;
  /** Keyboard focus is in it (the focus model's hook; no ring is drawn yet). */
  focused?: boolean;
}) {
  const colors = useColors();
  const state = useControlState({ disabled, focused });
  return (
    // One Tab stop, entered at the chosen segment; the arrows move between segments (KB-1).
    <View
      testID={testID}
      focusGroup
      accessibilityRole="tablist"
      data-focused={state.focused}
      style={{ flexDirection: "row", flexShrink: 0, height: 26, padding: 2, gap: 2, borderRadius: 8, backgroundColor: colors.button, opacity: state.opacity }}
    >
      {options.map((option) => (
        <Segment
          key={String(option.value)}
          label={option.label}
          chosen={option.value === value}
          width={segmentWidth}
          testID={`${testID}:${option.value}`}
          onPress={disabled ? undefined : () => onChange(option.value)}
        />
      ))}
    </View>
  );
}

/** One segment: raised when chosen, a wash under the pointer, deeper while held. */
function Segment({ label, chosen, width, testID, onPress }: { label: string; chosen: boolean; width?: number; testID: string; onPress?: () => void }) {
  const colors = useColors();
  const surface = useSurface();
  const state = useControlState({ disabled: onPress === undefined });
  const rest = chosen ? surface.card : "#00000000";
  return (
    <View
      testID={testID}
      focusable={onPress !== undefined}
      accessibilityRole="tab"
      accessibilityState={{ selected: chosen }}
      onPress={onPress}
      onPointer={state.onPointer}
      style={{
        ...(width !== undefined ? { width } : { paddingHorizontal: 12 }),
        borderRadius: 6,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: state.pressed && !chosen ? colors.pressed : rest,
        hoverBackgroundColor: onPress === undefined || chosen ? rest : state.pressed ? colors.pressed : colors.button,
        ...(chosen ? { shadow: "xs" as const } : {}),
      }}
    >
      <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: chosen ? "semibold" : "normal", color: colors.text, textAlign: "center" }}>
        {label}
      </Text>
    </View>
  );
}

export interface TextFieldProps {
  value: string;
  onChangeText: (text: string) => void;
  testID: string;
  placeholder?: string;
  /** Pixels; fills the row by default. */
  width?: number;
  autoFocus?: boolean;
  secure?: boolean;
  onSubmit?: (text: string) => void;
  onKeyPress?: (key: "Escape" | "ArrowUp" | "ArrowDown") => void;
}

export function TextField({ value, onChangeText, testID, placeholder, width, autoFocus, secure, onSubmit, onKeyPress }: TextFieldProps) {
  const colors = useColors();
  const surface = useSurface();
  return (
    <TextInput
      testID={testID}
      value={value}
      placeholder={placeholder}
      autoFocus={autoFocus}
      secureTextEntry={secure}
      onChangeText={onChangeText}
      onSubmitEditing={onSubmit}
      onKeyPress={onKeyPress}
      style={{
        ...(width !== undefined ? { width } : { flex: 1 }),
        height: 28,
        padding: 6,
        fontSize: 13,
        borderRadius: 7,
        color: colors.text,
        placeholderColor: colors.textDisabled,
        backgroundColor: surface.card,
        borderColor: colors.separator,
        focusBorderColor: colors.selection,
      }}
    />
  );
}

/** A rounded field with a magnifier; a clear button shows once something is typed. */
export function SearchField({
  value,
  onChangeText,
  testID,
  placeholder = "Search",
  width = 200,
  autoFocus,
  onKeyPress,
  onSubmit,
}: {
  value: string;
  onChangeText: (text: string) => void;
  testID: string;
  placeholder?: string;
  width?: number;
  autoFocus?: boolean;
  onKeyPress?: (key: "Escape" | "ArrowUp" | "ArrowDown") => void;
  onSubmit?: (text: string) => void;
}) {
  const colors = useColors();
  return (
    <View
      style={{
        width,
        height: 28,
        flexShrink: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingLeft: 8,
        paddingRight: 4,
        borderRadius: 7,
        backgroundColor: colors.button,
      }}
    >
      <Svg markup={SEARCH} size={13} color={colors.textMuted} />
      <TextInput
        testID={testID}
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmit}
        onKeyPress={(key) => {
          // Esc empties the field first, as on the Mac.
          if (key === "Escape" && value !== "") onChangeText("");
          else onKeyPress?.(key);
        }}
        style={{ flex: 1, height: 24, padding: 2, fontSize: 13, color: colors.text, placeholderColor: colors.textMuted, backgroundColor: "#00000000" }}
      />
      {value !== "" && (
        <View testID={`${testID}:clear`} onPress={() => onChangeText("")} style={{ width: 18, height: 18, alignItems: "center", justifyContent: "center" }}>
          <Svg markup={CLEAR} size={13} color={colors.textMuted} />
        </View>
      )}
    </View>
  );
}
