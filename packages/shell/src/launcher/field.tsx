/**
 * The launcher's one chrome row (VS-3): the search glyph, a chip naming what
 * the rows act on (the action list, Set alias…, a link's action), the field,
 * and at its right end the selected row's keys, or a word on what just
 * happened ("Copied"). Field 48 tall with 17 px text (LA-1, TY-1), times the
 * person's text size (measures.ts). No footer, no second header: hints live
 * here.
 */

import { SEARCH, Shortcut, useColors } from "@dashi/ui";
import { Image, Svg, Text, TextInput, View } from "@mirinjs/metal";
import { noticeAccess } from "./access.ts";
import { STANDARD, useMeasures } from "./measures.ts";
import type { RowIcon } from "./row-model.ts";
import type { Hint } from "./verbs.ts";

export const FIELD = { height: STANDARD.field, text: STANDARD.fieldText } as const;

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
  /** Props for the accessibility tree (access.ts): the field's role and name; none on a host without one. */
  access?: Record<string, unknown>;
  onChangeText(text: string): void;
  onSubmit(): void;
  onKey(key: "Escape" | "ArrowUp" | "ArrowDown"): void;
}

function ChipIcon({ icon, size }: { icon: RowIcon; size: number }) {
  const colors = useColors();
  if ("image" in icon) return <Image source={icon.image} style={{ width: size + 2, height: size + 2 }} />;
  if ("glyph" in icon) return <Svg markup={icon.glyph} size={size} color={colors.text} />;
  return null;
}

export function Field({ value, revision, placeholder, chip, hints, notice, glyph, access, onChangeText, onSubmit, onKey }: FieldProps) {
  const colors = useColors();
  const m = useMeasures();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 16, paddingRight: 16, height: m.field }}>
      <Svg markup={glyph?.markup ?? SEARCH} size={m.searchGlyph} color={glyph?.color ?? colors.textMuted} />
      {chip && (
        <View
          testID="launcher:chip"
          style={{
            flexShrink: 0,
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            height: m.chip,
            paddingLeft: 8,
            paddingRight: 8,
            borderRadius: 7,
            backgroundColor: colors.button,
          }}
        >
          {chip.icon && <ChipIcon icon={chip.icon} size={Math.round(m.title * 1.08)} />}
          <Text numberOfLines={1} style={{ fontSize: m.title, color: colors.text }}>
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
          {...(access ?? {})}
          style={{ flex: 1, fontSize: m.fieldText, color: colors.text, placeholderColor: colors.textMuted }}
        />
      </View>
      {notice ? (
        <View testID="launcher:notice" {...(access ? noticeAccess(notice.text) : {})} style={{ flexShrink: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: m.detail, color: notice.ok ? colors.textMuted : colors.critical }}>
            {notice.text}
          </Text>
        </View>
      ) : (
        hints.length > 0 && (
          <View testID="launcher:hints" style={{ flexShrink: 0, flexDirection: "row", alignItems: "center", gap: 10 }}>
            {hints.map((hint) => (
              <View key={hint.keys} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <Shortcut keys={hint.keys} color={colors.textMuted} size={m.small} />
                <Text style={{ fontSize: m.small, color: colors.textMuted }}>{hint.label}</Text>
              </View>
            ))}
          </View>
        )
      )}
    </View>
  );
}
