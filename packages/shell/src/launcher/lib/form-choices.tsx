/**
 * A form's choices, drawn by the launcher (frame L8): a Dropdown (the one
 * chosen, a chevron; pressed, its options open under it in place), a
 * TagPicker (the tags chosen; "+ Add" opens the others; a tag pressed goes),
 * and a Checkbox. Each part is a `focusable` view: ⇥ reaches it, Space and
 * Return press it. No popover: the launcher is one surface, and the
 * options open inside it.
 */

import type { ViewNode } from "@dashi/applet";
import { CHECK, CHEVRON_DOWN, pill, RADIUS, SPACE, useColors, useSurface, WEIGHT } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import { useState } from "react";
import { nameOf, optionsOf } from "./form-fields.ts";
import type { Measures } from "./measures.ts";

/** One option in an open list: its title, a check when chosen. */
function Choice({ title, chosen, onPress, testID, m }: { title: string; chosen: boolean; onPress(): void; testID: string; m: Measures }) {
  const colors = useColors();
  return (
    <View
      testID={testID}
      focusable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={{ flexDirection: "row", alignItems: "center", gap: SPACE.s, height: 24, paddingLeft: SPACE.m, paddingRight: SPACE.m, borderRadius: RADIUS.row }}
    >
      <View style={{ width: 12 }}>{chosen && <Svg markup={CHECK} size={12} color={colors.text} />}</View>
      <Text numberOfLines={1} style={{ fontSize: m.title, color: colors.text }}>
        {title}
      </Text>
    </View>
  );
}

/** The most options shown at once; more scroll (a repository has dozens of labels). */
const OPTIONS_SHOWN = 6;

function Options({ count, children }: { count: number; children: React.ReactNode }) {
  const colors = useColors();
  const surface = useSurface();
  const tall = count > OPTIONS_SHOWN;
  return (
    <View
      testID="launcher:form:options"
      style={{
        flexDirection: "column",
        padding: SPACE.xxs,
        borderRadius: RADIUS.control,
        borderWidth: 1,
        borderColor: colors.separator,
        backgroundColor: surface.card,
        ...(tall ? { height: OPTIONS_SHOWN * 24 + 6, overflow: "scroll" as const } : {}),
      }}
    >
      {children}
    </View>
  );
}

export function DropdownField({ field, value, change, m }: { field: ViewNode; value: string; change(value: string): void; m: Measures }) {
  const colors = useColors();
  const surface = useSurface();
  const [open, setOpen] = useState(false);
  const options = optionsOf(field);
  const name = nameOf(field);
  const shown = options.find((option) => option.value === value)?.title ?? value;
  return (
    <View style={{ flexDirection: "column", gap: SPACE.xs }}>
      <View
        testID={`launcher:form:${name}:button`}
        focusable
        accessibilityRole="button"
        accessibilityLabel={shown}
        onPress={() => setOpen((now) => !now)}
        style={{
          flexDirection: "row",
          alignItems: "center",
          height: 28,
          paddingLeft: SPACE.m,
          paddingRight: SPACE.m,
          borderRadius: RADIUS.control,
          borderWidth: 1,
          borderColor: colors.separator,
          backgroundColor: surface.card,
        }}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: m.title, color: colors.text }}>
            {shown}
          </Text>
        </View>
        <Svg markup={CHEVRON_DOWN} size={14} color={colors.textMuted} />
      </View>
      {open && (
        <Options count={options.length}>
          {options.map((option) => (
            <Choice
              key={option.value}
              title={option.title}
              chosen={option.value === value}
              testID={`launcher:form:${name}:option:${option.value}`}
              m={m}
              onPress={() => {
                change(option.value);
                setOpen(false);
              }}
            />
          ))}
        </Options>
      )}
    </View>
  );
}

/** A chosen tag: pressed, it goes. */
/** A chosen tag: a 20 pill. */
const CHOSEN = { height: 20 } as const;

function Chosen({ title, onPress, testID, m }: { title: string; onPress(): void; testID: string; m: Measures }) {
  const colors = useColors();
  return (
    <View
      testID={testID}
      focusable
      accessibilityRole="button"
      accessibilityLabel={`Remove ${title}`}
      onPress={onPress}
      style={{
        height: CHOSEN.height,
        paddingLeft: SPACE.m,
        paddingRight: SPACE.m,
        borderRadius: pill(CHOSEN.height),
        justifyContent: "center",
        backgroundColor: colors.button,
      }}
    >
      <Text style={{ fontSize: m.small, fontWeight: WEIGHT.semibold, color: colors.text }}>{title}</Text>
    </View>
  );
}

export function TagPickerField({ field, value, change, m }: { field: ViewNode; value: readonly string[]; change(value: string[]): void; m: Measures }) {
  const colors = useColors();
  const [open, setOpen] = useState(false);
  const options = optionsOf(field);
  const name = nameOf(field);
  const titleOf = (each: string): string => options.find((option) => option.value === each)?.title ?? each;
  const toggle = (each: string): void => change(value.includes(each) ? value.filter((one) => one !== each) : [...value, each]);
  return (
    <View style={{ flexDirection: "column", gap: SPACE.xs }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: SPACE.s, minHeight: 28 }}>
        {value.map((each) => (
          <Chosen key={each} title={titleOf(each)} onPress={() => toggle(each)} testID={`launcher:form:${name}:tag:${each}`} m={m} />
        ))}
        <View testID={`launcher:form:${name}:add`} focusable accessibilityRole="button" accessibilityLabel="Add" onPress={() => setOpen((now) => !now)}>
          <Text style={{ fontSize: m.detail, color: colors.textMuted }}>{open ? "Done" : "+ Add"}</Text>
        </View>
      </View>
      {open && (
        <Options count={options.length}>
          {options.map((option) => (
            <Choice
              key={option.value}
              title={option.title}
              chosen={value.includes(option.value)}
              testID={`launcher:form:${name}:option:${option.value}`}
              m={m}
              onPress={() => toggle(option.value)}
            />
          ))}
        </Options>
      )}
    </View>
  );
}

export function CheckboxField({ label, on, change, testID, m }: { label: string; on: boolean; change(value: boolean): void; testID: string; m: Measures }) {
  const colors = useColors();
  return (
    <View
      testID={testID}
      focusable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      onPress={() => change(!on)}
      style={{ flexDirection: "row", alignItems: "center", gap: SPACE.m, height: 28 }}
    >
      <View
        style={{
          width: 16,
          height: 16,
          borderRadius: RADIUS.check,
          borderWidth: 1,
          borderColor: on ? colors.primary : colors.controlEdge,
          backgroundColor: on ? colors.primary : colors.checkbox,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {on && <Svg markup={CHECK} size={12} color={colors.onPrimary} />}
      </View>
      <Text style={{ fontSize: m.title, color: colors.text }}>{label}</Text>
    </View>
  );
}
