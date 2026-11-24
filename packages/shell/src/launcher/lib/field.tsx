/**
 * The launcher's one chrome row (VS-3): the search glyph, a chip naming what
 * the rows act on (the action list, Set alias…, a link's action), the field,
 * and at its right end the selected row's keys, or a word on what just
 * happened ("Copied"). Field 48 tall with 17 px text (LA-1, TY-1), times the
 * person's text size (measures.ts). No footer, no second header: hints live
 * here.
 */

import { BareField, Chip, SEARCH, Shortcut, SPACE, useColors } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { noticeAccess } from "../access.ts";
import type { RowIcon } from "../row-model.ts";
import type { Hint } from "../verbs.ts";
import { fitWords, leastRoom, unmeasured, widthKey } from "./fit-words.ts";
import { STANDARD, useMeasures } from "./measures.ts";

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
  /** In place of the magnifier: the conversation wears the persona's spark (lib/talk/). */
  glyph?: { markup: string; color: string };
  /** After the hints: the conversation's round Stop or Send (lib/talk/). */
  trailing?: ReactNode;
  /** Props for the accessibility tree (access.ts): the field's role and name; none on a host without one. */
  access?: Record<string, unknown>;
  /** A secret is typed (an extension's token): the field shows dots. */
  secure?: boolean;
  /** An extension's form has the keyboard: when the form goes, the field takes it back (D468). */
  yields?: boolean;
  onChangeText(text: string): void;
  onSubmit(): void;
  onKey(key: "Escape" | "ArrowUp" | "ArrowDown"): void;
}

/** A number that grows each time `yielding` turns false: the form that had the keyboard went. */
function useRegained(yielding: boolean): number {
  const [count, setCount] = useState(0);
  const was = useRef(yielding);
  useEffect(() => {
    if (was.current && !yielding) setCount((n) => n + 1);
    was.current = yielding;
  }, [yielding]);
  return count;
}

/** Words measured as the field draws them, by size: the same words at the same size are measured once a session. */
const measured = new Map<string, number>();

/** What the field is about (an app, a scope), before the words: the kit's toolbar Chip, with the app's picture or glyph. */
function Scope({ chip }: { chip: NonNullable<FieldProps["chip"]> }) {
  const icon = chip.icon;
  return (
    <View style={{ flexShrink: 1, minWidth: 0 }}>
      <Chip
        testID="launcher:chip"
        label={chip.title}
        size="toolbar"
        {...(icon && "image" in icon ? { picture: icon.image } : {})}
        {...(icon && "glyph" in icon ? { glyph: icon.glyph } : {})}
      />
    </View>
  );
}

/** The keys that do something here, at the field's right end. */
function Hints({ hints }: { hints: readonly Hint[] }) {
  const colors = useColors();
  const m = useMeasures();
  return (
    <View testID="launcher:hints" style={{ flexShrink: 0, flexDirection: "row", alignItems: "center", gap: SPACE.gap }}>
      {hints.map((hint) => (
        <View key={hint.keys} style={{ flexDirection: "row", alignItems: "center", gap: SPACE.xs }}>
          <Shortcut keys={hint.keys} color={colors.textMuted} size={m.small} />
          <Text style={{ fontSize: m.small, color: colors.textMuted }}>{hint.label}</Text>
        </View>
      ))}
    </View>
  );
}

export function Field({
  value,
  revision,
  placeholder,
  chip,
  hints,
  notice,
  glyph,
  trailing,
  access,
  secure,
  yields,
  onChangeText,
  onSubmit,
  onKey,
}: FieldProps) {
  const colors = useColors();
  const m = useMeasures();
  const [room, setRoom] = useState<number | null>(null);
  const regained = useRegained(yields === true);
  const [, setMeasuredCount] = useState(0);
  const choices = typeof placeholder === "string" ? [placeholder] : placeholder;
  const widthOf = (text: string): number | undefined => measured.get(widthKey(text, m.fieldText));
  const shown = choices.length > 1 ? fitWords(choices, room, widthOf) : (choices[0] ?? "");
  const toMeasure = choices.length > 1 ? unmeasured(choices, widthOf) : [];
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.gap, paddingLeft: SPACE.page, paddingRight: SPACE.page, height: m.field }}>
      <Svg markup={glyph?.markup ?? SEARCH} size={m.searchGlyph} color={glyph?.color ?? colors.textMuted} />
      {chip && <Scope chip={chip} />}
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
        {/* Mounted again when a form goes: autoFocus is the only way to take the keyboard back (never as it comes: its own first field takes it). */}
        <BareField
          focusKey={`field:${regained}`}
          testID="launcher:field"
          value={value}
          {...(revision === undefined ? {} : { revision })}
          placeholder={shown}
          size={m.fieldText}
          {...(secure ? { secure: true } : {})}
          onChangeText={onChangeText}
          onSubmit={onSubmit}
          onKeyPress={onKey}
          {...(access ? { access } : {})}
        />
      </View>
      {notice ? (
        <View testID="launcher:notice" {...(access ? noticeAccess(notice.text) : {})} style={{ flexShrink: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: m.detail, color: notice.ok ? colors.textMuted : colors.critical }}>
            {notice.text}
          </Text>
        </View>
      ) : (
        hints.length > 0 && <Hints hints={hints} />
      )}
      {trailing}
    </View>
  );
}
