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
import { useColors, useSurface } from "@dashi/ui";
import { Text, TextInput, View } from "@mirinjs/metal";
import type { ReactNode } from "react";
import { CheckboxField, DropdownField, TagPickerField } from "./form-choices.tsx";
import { nameOf } from "./form-fields.ts";
import type { Measures } from "./measures.ts";
import type { FormPart } from "./tree-rows.ts";

/** The labels' column, and a long field's height (L8). */
export const FORM = { label: 96, gap: 14, line: 28, area: 88, padX: 16, padY: 7 } as const;

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
      <View style={{ width: FORM.label, paddingTop: 6, alignItems: "flex-end" }}>
        <Text numberOfLines={1} style={{ fontSize: m.detail, color: colors.textMuted }}>
          {label}
        </Text>
      </View>
      <View style={{ flex: 1, minWidth: 0, flexDirection: "column", gap: 3 }}>
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

/** A line of words, or a long text (a description). */
function Words({ field, value, change, keys, m }: { field: ViewNode; value: string; change(value: string): void; keys: FieldKeys; m: Measures }) {
  const colors = useColors();
  const surface = useSurface();
  const long = field.t === "TextArea";
  const placeholder = words(field, "placeholder");
  return (
    <TextInput
      testID={`launcher:form:${nameOf(field)}:input`}
      value={value}
      {...(placeholder ? { placeholder } : {})}
      {...(keys.first ? { autoFocus: true } : {})}
      {...(field.p.secure === true ? { secureTextEntry: true } : {})}
      {...(long ? { multiline: true, submitBehavior: "newline" as const } : { focusNextOnSubmit: true })}
      onChangeText={change}
      // A line moves on (focusNextOnSubmit); a long field's ⌃↩ sends.
      onSubmitEditing={long ? keys.submit : undefined}
      onKeyPress={(key) => {
        if (key === "Escape") keys.escape();
      }}
      style={{
        ...(long ? { height: FORM.area } : { height: FORM.line }),
        padding: 6,
        fontSize: m.title,
        borderRadius: 7,
        color: colors.text,
        placeholderColor: colors.textDisabled,
        backgroundColor: surface.card,
        borderColor: colors.separator,
        focusBorderColor: colors.focusRing,
      }}
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
    <View testID="launcher:form" style={{ flexDirection: "column", paddingTop: 4, paddingBottom: 6 }}>
      {form.root.c.map((node) => {
        if (node.t === "Separator") return <View key={node.i} style={{ height: 1, marginTop: 4, marginBottom: 4, backgroundColor: colors.separator }} />;
        if (node.t === "Description")
          return (
            <Line key={node.i} label={words(node, "title") ?? ""} m={m} testID={`launcher:form:${node.i}`}>
              <View style={{ paddingTop: 5 }}>
                <Text style={{ fontSize: m.title, color: colors.text }}>{words(node, "text") ?? ""}</Text>
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
