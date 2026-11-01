/**
 * The kit's controls beyond the shared ones (src/ui): a segmented control,
 * a text field, and a search field. They paint with the live palette.
 */

import { Svg, Text, TextInput, View } from "@mirinjs/metal";
import { useColors } from "../../src/theme.ts";
import { type Choice, useSurface } from "../../src/ui/index.ts";
import { CLEAR, SEARCH } from "./glyphs.ts";

/** macOS's segmented control: a sunk track, the chosen segment raised on it. */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  testID,
  segmentWidth,
}: {
  options: ReadonlyArray<Choice<T>>;
  value: T;
  onChange: (value: T) => void;
  testID: string;
  /** Every segment this wide; by default each fits its label. */
  segmentWidth?: number;
}) {
  const colors = useColors();
  const surface = useSurface();
  return (
    <View testID={testID} style={{ flexDirection: "row", flexShrink: 0, height: 26, padding: 2, gap: 2, borderRadius: 8, backgroundColor: colors.button }}>
      {options.map((option) => {
        const chosen = option.value === value;
        return (
          <View
            key={String(option.value)}
            testID={`${testID}:${option.value}`}
            onPress={() => onChange(option.value)}
            style={{
              ...(segmentWidth !== undefined ? { width: segmentWidth } : { paddingHorizontal: 12 }),
              borderRadius: 6,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: chosen ? surface.card : "#00000000",
              hoverBackgroundColor: chosen ? surface.card : colors.button,
              ...(chosen ? { shadow: "xs" as const } : {}),
            }}
          >
            <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: chosen ? "semibold" : "normal", color: colors.text, textAlign: "center" }}>
              {option.label}
            </Text>
          </View>
        );
      })}
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
    <View style={{ width, height: 28, flexShrink: 0, flexDirection: "row", alignItems: "center", gap: 4, paddingLeft: 8, paddingRight: 4, borderRadius: 7, backgroundColor: colors.button }}>
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
