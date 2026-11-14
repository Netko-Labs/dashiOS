/**
 * The bar's row as the field, as drawn (../field.ts; docs/design.html, "The
 * bar's row as the field"): a surface over the whole screen whose top row
 * sits exactly on the menu bar, 28 tall, so the bar never grows. The logo
 * stays at the left, the clock and the signs that someone records or
 * listens at the right; between them Dashi's capsule, the field with the
 * caret, and what the keys do. Under the row the surface is clear: a click
 * there closes the field, as it closes a menu. With no model chosen the row
 * says so and offers System Settings; no key, password or code is ever
 * typed here.
 */

import { buttonLook, LOGO, Shortcut, useColors } from "@dashi/ui";
import { Svg, Text, TextInput, View } from "@mirinjs/metal";
import { useMemo, useSyncExternalStore } from "react";
import { opaque } from "../../consent.tsx";
import { KeyCatcher } from "../../overlay.tsx";
import type { Cell, Persona } from "../../shared/pill/index.ts";
import { DEFAULT_PERSONA, markSvg } from "../../shared/pill/index.ts";
import { MENU_BAR_HEIGHT } from "../../theme.ts";
import type { BarField } from "../field.ts";
import { CAPSULE } from "./bar-jobs.ts";
import { type StatusSources, useStatusSlots } from "./menubar-program-slots.tsx";

/** The signs that stay in the row while it is the field: who records, who listens, and the clock. */
const STAYS = new Set(["capture", "recording", "microphone", "clock"]);

/** The field's measures (docs/design.html, "The bar's row as the field"). */
export const FIELD_ROW = { logoLeft: 16, lead: 20, text: 13, hint: 10.5, key: 16, edge: 1.5 } as const;

/** Dashi's capsule at the head of the field: who the words go to. */
function Lead({ name, colour, glyph }: { name: string; colour: string; glyph: string }) {
  return (
    <View
      testID="bar-field-lead"
      style={{
        flexShrink: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: CAPSULE.gap,
        height: CAPSULE.height,
        paddingLeft: CAPSULE.left,
        paddingRight: CAPSULE.right,
        borderRadius: CAPSULE.height / 2,
        backgroundColor: colour,
      }}
    >
      <View
        style={{
          width: CAPSULE.ring,
          height: CAPSULE.ring,
          borderRadius: CAPSULE.ring / 2,
          backgroundColor: "#ffffff59",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <View
          style={{
            width: CAPSULE.disc,
            height: CAPSULE.disc,
            borderRadius: CAPSULE.disc / 2,
            backgroundColor: "#ffffff",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Svg markup={glyph} size={CAPSULE.glyph + 2} color={colour} />
        </View>
      </View>
      <Text numberOfLines={1} style={{ fontSize: CAPSULE.fontSize, fontWeight: "semibold", color: "#ffffff" }}>
        {name}
      </Text>
    </View>
  );
}

/** A key and what it does, small and muted, at the row's right. */
function Hint({ keys, label }: { keys: string; label: string }) {
  const colors = useColors();
  return (
    <View style={{ flexShrink: 0, flexDirection: "row", alignItems: "center", gap: 4 }}>
      <View
        style={{
          height: FIELD_ROW.key,
          minWidth: FIELD_ROW.key,
          paddingLeft: 4,
          paddingRight: 4,
          borderRadius: 4,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.button,
        }}
      >
        <Shortcut keys={keys} color={colors.textMuted} size={FIELD_ROW.hint} />
      </View>
      <Text style={{ fontSize: FIELD_ROW.hint, color: colors.textMuted }}>{label}</Text>
    </View>
  );
}

/** No model is chosen: what is missing and the way on. Return opens System Settings; nothing is sent. */
function NoModel({ name, accessible, onSetUp, onClose }: { name: string; accessible: boolean; onSetUp: () => void; onClose: () => void }) {
  const colors = useColors();
  const look = buttonLook(colors, "primary");
  return (
    <>
      <KeyCatcher testID="bar-field-keys" onKey={(key) => key === "Escape" && onClose()} onSubmit={onSetUp} />
      <View testID="bar-field-no-model" style={{ flex: 1, minWidth: 0, marginLeft: 8 }}>
        <Text numberOfLines={1} style={{ fontSize: FIELD_ROW.text, color: colors.text }}>{`${name} has no model yet.`}</Text>
      </View>
      <View
        testID="bar-field-set-up"
        onPress={onSetUp}
        {...(accessible ? { accessibilityRole: "button" as const, accessibilityLabel: "Choose one in Settings" } : {})}
        style={{
          flexShrink: 0,
          flexDirection: "row",
          alignItems: "center",
          gap: 5,
          height: CAPSULE.height,
          paddingLeft: 10,
          paddingRight: 8,
          borderRadius: CAPSULE.height / 2,
          backgroundColor: look.fill,
          hoverBackgroundColor: look.hover,
        }}
      >
        <Text style={{ fontSize: 11, fontWeight: "semibold", color: look.ink }}>Choose one in Settings</Text>
        <Shortcut keys="↩" color={look.ink} size={FIELD_ROW.hint} />
      </View>
      <View style={{ marginLeft: 10 }}>
        <Hint keys="Esc" label="not now" />
      </View>
    </>
  );
}

export interface FieldRowProps {
  field: BarField;
  persona: Pick<Cell<Persona>, "subscribe" | "getSnapshot">;
  /** What the bar's status side is built from: the clock and the signs stay in the row. */
  bar: StatusSources;
}

export function FieldRow({ field, persona, bar }: FieldRowProps) {
  const colors = useColors();
  const state = useSyncExternalStore(field.subscribe, field.getSnapshot);
  const who = useSyncExternalStore(persona.subscribe, persona.getSnapshot);
  const colour = who.colour.toLowerCase() === DEFAULT_PERSONA.colour.toLowerCase() ? colors.agent : who.colour;
  const accessible = bar.accessible?.() ?? false;
  const stays = useStatusSlots(bar, null, "", null).filter((slot) => STAYS.has(slot.key));
  // The caret is put where the field's state says only when the text came from outside (dictated words, a reopened draft).
  // biome-ignore lint/correctness/useExhaustiveDependencies: the caret as it was when the text was last set from outside.
  const selection = useMemo(() => ({ start: state.caret, end: state.caret }), [state.revision]);
  return (
    <View style={{ flex: 1, flexDirection: "column" }}>
      <View
        testID="bar-field"
        style={{
          height: MENU_BAR_HEIGHT,
          flexDirection: "row",
          alignItems: "center",
          paddingLeft: FIELD_ROW.logoLeft,
          paddingRight: 6,
          position: "relative",
          backgroundColor: opaque(colors.menu),
        }}
      >
        <Svg markup={LOGO} size={16} color={colors.text} />
        <View style={{ width: 20 }} />
        <Lead name={who.name} colour={colour} glyph={markSvg(who.mark)} />
        {state.noModel ? (
          <NoModel name={who.name} accessible={accessible} onSetUp={() => field.submit()} onClose={() => field.close()} />
        ) : (
          <>
            <View style={{ width: 8 }} />
            <TextInput
              testID="bar-field-input"
              value={state.text}
              valueRevision={state.revision}
              selection={selection}
              placeholder={`Ask ${who.name}, or give it a job`}
              autoFocus
              {...(accessible ? { accessibilityLabel: `Ask ${who.name}` } : {})}
              onChangeText={(text) => field.type(text)}
              onSelectionChange={(now) => field.caretAt(now.end)}
              onSubmitEditing={() => field.submit()}
              onKeyPress={(key) => key === "Escape" && field.close()}
              style={{ flex: 1, fontSize: FIELD_ROW.text, color: colors.text, placeholderColor: colors.textMuted }}
            />
            <View style={{ flexShrink: 0, flexDirection: "row", alignItems: "center", gap: 10, marginLeft: 10 }}>
              <Hint keys="↩" label="go" />
              <Hint keys="Esc" label="close" />
            </View>
          </>
        )}
        <View testID="bar-field-signs" style={{ flexShrink: 0, flexDirection: "row", alignItems: "center", gap: 4, marginLeft: 10 }}>
          {stays.map((slot) => (
            <View key={slot.key}>{slot.node}</View>
          ))}
        </View>
        <View testID="bar-field-edge" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: FIELD_ROW.edge, backgroundColor: colour }} />
      </View>
      {/* Under the row: a click anywhere closes the field and the menus are back. */}
      <View testID="bar-field-backdrop" style={{ flex: 1 }} onPress={() => field.close()} />
    </View>
  );
}
