/**
 * An extension's form, drawn by the launcher (store-v2 frame L8): one field
 * a line, its label at the left in a column 96 wide, the field, and under it
 * the extension's line (`info`) or what is wrong (in ume, once a send was
 * tried, or the extension's own `invalid`). ⇥ moves between fields (the
 * launcher gives ⇥ back while a form shows: keys.ts), Return moves on from a
 * line, ❖↩ sends (Return in a long field is a new line; ⌃↩ sends too).
 * Esc steps out as anywhere in the launcher; a form that keeps a draft says
 * so at its foot. In the launcher's own type and fields (CO-6).
 */

import type { FieldValue, ViewNode } from "@dashi/applet";
import { SPACE, TextArea, TextField, useColors } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import type { ReactNode } from "react";
import { CheckboxField, DropdownField, TagPickerField } from "./form-choices.tsx";
import { nameOf } from "./form-fields.ts";
import type { Measures } from "./measures.ts";
import type { FormPart } from "./tree-rows.ts";

/** The labels' column, and a long field's height (L8). */
export const FORM = { label: 96, gap: SPACE.button, line: 28, area: 88, padX: 16, padY: 7 } as const;

const words = (node: ViewNode, name: string): string | undefined => {
  const value = node.p[name];
  return typeof value === "string" ? value : undefined;
};

/** A label, the field, and the line under it. */
function Line({
  label,
  under,
  wrong,
  m,
  children,
  testID,
}: {
  label: string;
  under?: string;
  wrong?: boolean;
  m: Measures;
  children: ReactNode;
  testID: string;
}) {
  const colors = useColors();
  return (
    <View
      testID={testID}
      style={{
        flexDirection: "row",
        gap: FORM.gap,
        alignItems: "flex-start",
        paddingLeft: FORM.padX,
        paddingRight: FORM.padX,
        paddingTop: FORM.padY,
        paddingBottom: FORM.padY,
      }}
    >
      <View style={{ width: FORM.label, paddingTop: SPACE.s, alignItems: "flex-end" }}>
        <Text numberOfLines={1} style={{ fontSize: m.detail, color: colors.textMuted }}>
          {label}
        </Text>
      </View>
      <View style={{ flex: 1, minWidth: 0, flexDirection: "column", gap: SPACE.xxs }}>
        {children}
        {under !== undefined && (
          <View testID={`${testID}:under`}>
            <Text style={{ fontSize: m.small, color: wrong ? colors.critical : colors.textMuted }}>{under}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

interface FieldKeys {
  /** The first words field takes the keyboard when the form comes (L8: the title). */
  first: boolean;
  submit(): void;
  escape(): void;
}

/** A line of words (the kit's TextField; Return moves on), or a long text (its TextArea; ⌃↩ sends). */
function Words({ field, value, change, keys }: { field: ViewNode; value: string; change(value: string): void; keys: FieldKeys; m: Measures }) {
  const placeholder = words(field, "placeholder");
  const testID = `launcher:form:${nameOf(field)}:input`;
  const onKeyPress = (key: "Escape" | "ArrowUp" | "ArrowDown"): void => {
    if (key === "Escape") keys.escape();
  };
  if (field.t === "TextArea") {
    return (
      <TextArea
        testID={testID}
        value={value}
        {...(placeholder ? { placeholder } : {})}
        {...(keys.first ? { autoFocus: true } : {})}
        height={FORM.area}
        onChangeText={change}
        onSubmit={keys.submit}
        onKeyPress={onKeyPress}
      />
    );
  }
  return (
    <TextField
      testID={testID}
      value={value}
      {...(placeholder ? { placeholder } : {})}
      {...(keys.first ? { autoFocus: true } : {})}
      {...(field.p.secure === true ? { secure: true } : {})}
      focusNextOnSubmit
      onChangeText={change}
      onKeyPress={onKeyPress}
    />
  );
}

function FieldControl({ field, form, keys, m }: { field: ViewNode; form: FormPart; keys: FieldKeys; m: Measures }) {
  const name = nameOf(field);
  const value = form.values[name];
  const change = (next: FieldValue) => form.change(name, next);
  switch (field.t) {
    case "TextField":
    case "TextArea":
      return <Words field={field} value={typeof value === "string" ? value : ""} change={change} keys={keys} m={m} />;
    case "Dropdown":
      return <DropdownField field={field} value={typeof value === "string" ? value : ""} change={change} m={m} />;
    case "TagPicker":
      return <TagPickerField field={field} value={Array.isArray(value) ? value : []} change={change} m={m} />;
    case "Checkbox":
      return <CheckboxField label={words(field, "label") ?? ""} on={value === true} change={change} testID={`launcher:form:${name}:box`} m={m} />;
    default:
      return null;
  }
}

/** The form: its fields and words in order, and a kept draft said at its foot. */
export function FormBody({ form, m, submit, escape }: { form: FormPart; m: Measures; submit(): void; escape(): void }) {
  const colors = useColors();
  const firstWords = form.root.c.find((node) => node.t === "TextField" || node.t === "TextArea");
  return (
    <View testID="launcher:form" style={{ flexDirection: "column", paddingTop: SPACE.xs, paddingBottom: SPACE.s }}>
      {form.root.c.map((node) => {
        if (node.t === "Separator")
          return <View key={node.i} style={{ height: 1, marginTop: SPACE.xs, marginBottom: SPACE.xs, backgroundColor: colors.separator }} />;
        if (node.t === "Description")
          return (
            <Line key={node.i} label={words(node, "title") ?? ""} m={m} testID={`launcher:form:${node.i}`}>
              <View style={{ paddingTop: SPACE.xs }}>
                <Text style={{ fontSize: m.detail, color: colors.textMuted }}>{words(node, "text") ?? ""}</Text>
              </View>
            </Line>
          );
        if (node.t === "ActionPanel") return null;
        const name = nameOf(node);
        const wrong = form.problems[name];
        const info = words(node, "info");
        return (
          <Line
            key={node.i}
            label={words(node, "title") ?? name}
            m={m}
            testID={`launcher:form:${name}`}
            {...(wrong ? { under: wrong, wrong: true } : info ? { under: info } : {})}
          >
            <FieldControl field={node} form={form} keys={{ first: node === firstWords, submit, escape }} m={m} />
          </Line>
        );
      })}
      {form.root.p.draft === true && (
        <Line label="" m={m} testID="launcher:form:draft">
          <Text style={{ fontSize: m.small, color: colors.textMuted }}>A draft is kept if you close the launcher.</Text>
        </Line>
      )}
    </View>
  );
}
