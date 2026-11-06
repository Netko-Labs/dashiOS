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
import { useState } from "react";
import { noticeAccess } from "./access.ts";
import { fitWords, leastRoom, unmeasured, widthKey } from "./fit-words.ts";
import { STANDARD, useMeasures } from "./measures.ts";
import type { RowIcon } from "./row-model.ts";
import type { Hint } from "./verbs.ts";

export const FIELD = { height: STANDARD.field, text: STANDARD.fieldText } as const;

export interface FieldProps {
  value: string;
  /** Bumped when the launcher took a key for itself (Space flipping a switch), so the field shows `value` again. */
  revision?: number;
  /** The words the empty field shows; several, fullest first, and the fullest that fits whole is shown (fit-words.ts). */
  placeholder: string | readonly string[];
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

/** Words measured as the field draws them, by size: the same words at the same size are measured once a session. */
const measured = new Map<string, number>();

export function Field({ value, revision, placeholder, chip, hints, notice, glyph, access, onChangeText, onSubmit, onKey }: FieldProps) {
  const colors = useColors();
  const m = useMeasures();
  const [room, setRoom] = useState<number | null>(null);
  const [, setMeasuredCount] = useState(0);
  const choices = typeof placeholder === "string" ? [placeholder] : placeholder;
  const widthOf = (text: string): number | undefined => measured.get(widthKey(text, m.fieldText));
  const shown = choices.length > 1 ? fitWords(choices, room, widthOf) : (choices[0] ?? "");
  const toMeasure = choices.length > 1 ? unmeasured(choices, widthOf) : [];
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 16, paddingRight: 16, height: m.field }}>
      <Svg markup={glyph?.markup ?? SEARCH} size={m.searchGlyph} color={glyph?.color ?? colors.textMuted} />
      {chip && (
        <View
          testID="launcher:chip"
          style={{
            // It gives way before the field's least room (a long request at the largest text size).
            flexShrink: 1,
            minWidth: 0,
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
      <View
        testID="launcher:field-room"
        style={{ flex: 1, minWidth: leastRoom(choices, widthOf), flexDirection: "row", alignItems: "center" }}
        {...(choices.length > 1 ? { onLayout: (bounds: { width: number }) => setRoom(bounds.width) } : {})}
      >
        {/* The placeholder's choices, measured once at this size, never seen: then they go. */}
        {toMeasure.map((text) => (
          <View
            key={text}
            testID={`launcher:measure:${text}`}
            onLayout={(bounds) => {
              measured.set(widthKey(text, m.fieldText), bounds.width);
              setMeasuredCount(measured.size);
            }}
            style={{ position: "absolute", left: 0, top: 0, opacity: 0 }}
          >
            <Text numberOfLines={1} style={{ fontSize: m.fieldText }}>
              {text}
            </Text>
          </View>
        ))}
        {/* Metal draws a focused empty field's placeholder, muted, right after the caret. */}
        <TextInput
          testID="launcher:field"
          value={value}
          {...(revision === undefined ? {} : { valueRevision: revision })}
          placeholder={shown}
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
