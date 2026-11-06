/**
 * The launcher's one chrome row (VS-3): the search glyph, a chip naming what
 * the rows act on (the action list, Set alias…, a link's action), the field,
 * and at its right end the selected row's keys, or a word on what just
 * happened ("Copied"). Field 48 tall with 17 px text (LA-1, TY-1). No
 * footer, no second header: hints live here.
 */

import { SEARCH, Shortcut, useColors } from "@dashi/ui";
import { Image, Svg, Text, TextInput, View } from "@mirinjs/metal";
import type { RowIcon } from "./row-model.ts";
import type { Hint } from "./verbs.ts";

export const FIELD = { height: 48, text: 17 } as const;

export interface FieldProps {
  value: string;
  /** Bumped when the launcher took a key for itself (Space flipping a switch), so the field shows `value` again. */
  revision?: number;
  placeholder: string;
  /** What the rows act on, in a chip before the field. */
  chip?: { title: string; icon?: RowIcon };
  hints: readonly Hint[];
  /** A word on what just happened; it takes the hints' place. */
  notice?: { text: string; ok: boolean } | null;
  /** In place of the magnifier: an agent's plan wears the shiso spark (agents/plan-view.tsx). */
  glyph?: { markup: string; color: string };
  onChangeText(text: string): void;
  onSubmit(): void;
  onKey(key: "Escape" | "ArrowUp" | "ArrowDown"): void;
}

function ChipIcon({ icon }: { icon: RowIcon }) {
  const colors = useColors();
  if ("image" in icon) return <Image source={icon.image} style={{ width: 16, height: 16 }} />;
  if ("glyph" in icon) return <Svg markup={icon.glyph} size={14} color={colors.text} />;
  return null;
}

export function Field({ value, revision, placeholder, chip, hints, notice, glyph, onChangeText, onSubmit, onKey }: FieldProps) {
  const colors = useColors();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 16, paddingRight: 16, height: FIELD.height }}>
      <Svg markup={glyph?.markup ?? SEARCH} size={18} color={glyph?.color ?? colors.textMuted} />
      {chip && (
        <View
          testID="launcher:chip"
          style={{
            flexShrink: 0,
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            height: 26,
            paddingLeft: 8,
            paddingRight: 8,
            borderRadius: 7,
            backgroundColor: colors.button,
          }}
        >
          {chip.icon && <ChipIcon icon={chip.icon} />}
          <Text numberOfLines={1} style={{ fontSize: 13, color: colors.text }}>
            {chip.title}
          </Text>
        </View>
      )}
      <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center" }}>
        {/* Metal draws a focused empty field's placeholder, muted, right after the caret. */}
        <TextInput
          testID="launcher:field"
          value={value}
          {...(revision === undefined ? {} : { valueRevision: revision })}
          placeholder={placeholder}
          autoFocus
          onChangeText={onChangeText}
          onSubmitEditing={onSubmit}
          onKeyPress={onKey}
          style={{ flex: 1, fontSize: FIELD.text, color: colors.text, placeholderColor: colors.textMuted }}
        />
      </View>
      {notice ? (
        <View testID="launcher:notice" style={{ flexShrink: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: 12, color: notice.ok ? colors.textMuted : colors.critical }}>
            {notice.text}
          </Text>
        </View>
      ) : (
        hints.length > 0 && (
          <View testID="launcher:hints" style={{ flexShrink: 0, flexDirection: "row", alignItems: "center", gap: 10 }}>
            {hints.map((hint) => (
              <View key={hint.keys} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <Shortcut keys={hint.keys} color={colors.textMuted} size={11} />
                <Text style={{ fontSize: 11, color: colors.textMuted }}>{hint.label}</Text>
              </View>
            ))}
          </View>
        )
      )}
    </View>
  );
}
