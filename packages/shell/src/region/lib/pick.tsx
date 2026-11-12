/**
 * Small pieces the time zone and language pickers share: a search field and
 * a list of rows where one is chosen. The same look as Keyboard's layout
 * list, so a person who has seen one knows the other.
 */

import { rowLook, SEARCH, SelectionBar } from "@dashi/ui";
import { ScrollView, Svg, Text, TextInput, View } from "@mirinjs/metal";
import type { ReactNode } from "react";
import { useColors } from "../../settings-app/colors.ts";
import { useSurface } from "../../shared/cards/index.ts";

export function SearchField({
  value,
  onChange,
  placeholder,
  testID,
}: {
  value: string;
  onChange: (text: string) => void;
  placeholder: string;
  testID: string;
}) {
  const colors = useColors();
  const surface = useSurface();
  return (
    <View
      style={{
        flexShrink: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        height: 28,
        paddingHorizontal: 8,
        borderRadius: 8,
        backgroundColor: surface.field,
      }}
    >
      <Svg markup={SEARCH} size={13} color={colors.textMuted} />
      <TextInput
        testID={testID}
        value={value}
        placeholder={placeholder}
        onChangeText={onChange}
        style={{ flex: 1, fontSize: 12, color: colors.text, placeholderColor: colors.textMuted, backgroundColor: "#00000000" }}
      />
    </View>
  );
}

export function PickRow({ label, detail, chosen, testID, onPress }: { label: string; detail?: string; chosen: boolean; testID: string; onPress: () => void }) {
  const look = rowLook(useColors(), chosen);
  return (
    <View
      testID={testID}
      onPress={onPress}
      style={{
        height: 28,
        flexShrink: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 8,
        borderRadius: 6,
        backgroundColor: look.ground,
        hoverBackgroundColor: look.hover,
      }}
    >
      {chosen && <SelectionBar rowHeight={28} />}
      <View style={{ flexShrink: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 12, color: look.ink }}>
          {label}
        </Text>
      </View>
      {detail !== undefined && (
        <View style={{ marginLeft: "auto", flexShrink: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: 11, color: look.quiet }}>
            {detail}
          </Text>
        </View>
      )}
    </View>
  );
}

export function PickList({ children, testID, height }: { children: ReactNode; testID: string; height: number }) {
  const surface = useSurface();
  return (
    <ScrollView testID={testID} style={{ flex: 1, height, flexDirection: "column", padding: 4, borderRadius: 8, backgroundColor: surface.field }}>
      {children}
    </ScrollView>
  );
}

/** A line inside a list: nothing found, or more than are shown. */
export function PickNote({ children, testID }: { children: string; testID?: string }) {
  const colors = useColors();
  return (
    <View testID={testID} style={{ flexShrink: 0, padding: 10, alignItems: "center" }}>
      <Text style={{ fontSize: 11, color: colors.textMuted, textAlign: "center" }}>{children}</Text>
    </View>
  );
}
