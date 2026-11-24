/**
 * A form's choices, drawn by the launcher (frame L8) from the kit: a
 * Dropdown (the kit's pop-up button; pressed, its options open under it in
 * place as pick rows), a TagPicker (the tags chosen, each a small Button
 * that takes it away; "Add…" opens the others), and the kit's Checkbox.
 * ⇥ reaches each, Space and Return press it. No popover: the launcher is
 * one surface, and the options open inside it.
 */

import type { ViewNode } from "@dashi/applet";
import { Button, Checkbox, PICK_ROW, PickRow, PopUpButton, RADIUS, SPACE, useColors, useSurface } from "@dashi/ui";
import { View } from "@mirinjs/metal";
import { useState } from "react";
import { nameOf, optionsOf } from "./form-fields.ts";
import type { Measures } from "./measures.ts";

/** The most options shown at once; more scroll (a repository has dozens of labels). */
const OPTIONS_SHOWN = 6;

/** The open options, in place under their control: the kit's pick rows on a card. */
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
        ...(tall ? { height: OPTIONS_SHOWN * PICK_ROW.height + 2 * SPACE.xxs, overflow: "scroll" as const } : {}),
      }}
    >
      {children}
    </View>
  );
}

/** A Dropdown: the kit's pop-up button, its options opening in place (the launcher is one surface: no menu over it). */
export function DropdownField({ field, value, change }: { field: ViewNode; value: string; change(value: string): void; m: Measures }) {
  const [open, setOpen] = useState(false);
  const options = optionsOf(field);
  const name = nameOf(field);
  return (
    <View style={{ flexDirection: "column", gap: SPACE.xs }}>
      <PopUpButton
        testID={`launcher:form:${name}:button`}
        options={options.map((option) => ({ value: option.value, label: option.title }))}
        value={value}
        onChange={change}
        opensInPlace={() => setOpen((now) => !now)}
      />
      {open && (
        <Options count={options.length}>
          {options.map((option) => (
            <PickRow
              key={option.value}
              label={option.title}
              chosen={option.value === value}
              testID={`launcher:form:${name}:option:${option.value}`}
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

/** A TagPicker: each chosen tag a small Button that takes it away, "Add" opening the others in place. */
export function TagPickerField({ field, value, change }: { field: ViewNode; value: readonly string[]; change(value: string[]): void; m: Measures }) {
  const [open, setOpen] = useState(false);
  const options = optionsOf(field);
  const name = nameOf(field);
  const titleOf = (each: string): string => options.find((option) => option.value === each)?.title ?? each;
  const toggle = (each: string): void => change(value.includes(each) ? value.filter((one) => one !== each) : [...value, each]);
  return (
    <View style={{ flexDirection: "column", gap: SPACE.xs }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: SPACE.s, minHeight: PICK_ROW.height }}>
        {value.map((each) => (
          <Button
            key={each}
            testID={`launcher:form:${name}:tag:${each}`}
            label={titleOf(each)}
            accessibilityLabel={`Remove ${titleOf(each)}`}
            size="small"
            onPress={() => toggle(each)}
          />
        ))}
        <Button testID={`launcher:form:${name}:add`} label={open ? "Done" : "Add…"} size="small" onPress={() => setOpen((now) => !now)} />
      </View>
      {open && (
        <Options count={options.length}>
          {options.map((option) => (
            <PickRow
              key={option.value}
              label={option.title}
              chosen={value.includes(option.value)}
              testID={`launcher:form:${name}:option:${option.value}`}
              onPress={() => toggle(option.value)}
            />
          ))}
        </Options>
      )}
    </View>
  );
}

/** A Checkbox: the kit's (UI-10). */
export function CheckboxField({ label, on, change, testID }: { label: string; on: boolean; change(value: boolean): void; testID: string; m: Measures }) {
  return <Checkbox testID={testID} label={label} checked={on} onChange={change} />;
}
