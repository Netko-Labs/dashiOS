/**
 * Small pieces the panes share beyond ui.tsx's: a value at the end of a row,
 * the row-end button, a list row, a round icon, a destructive action that
 * confirms in place, and a failure's sentence.
 */

import { Button, CLEAR, Knob, SelectionBar, SPACE, TYPE, WEIGHT } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import { type ReactNode, useState } from "react";
import { useColors } from "../../colors.ts";
import { PAGE, useCardRow } from "../row.tsx";

/** A value at the end of a row, muted and right-aligned (several lines stack). */
export function Value({ children, testID }: { children: string | readonly string[]; testID?: string }) {
  const colors = useColors();
  const lines = typeof children === "string" ? [children] : children;
  return (
    <View testID={testID} style={{ flexShrink: 1, flexDirection: "column", alignItems: "flex-end", minWidth: 0 }}>
      {lines.map((line, index) => (
        // Lines of a value never reorder.
        <Text key={index} numberOfLines={1} style={{ fontSize: TYPE.panel.body.size, color: colors.textMuted, textAlign: "right" }}>
          {line}
        </Text>
      ))}
    </View>
  );
}

/** A button at a row's end (SE-11): Join, Forget, Connect; the 28 pill in Control Center's language. */
export function MiniButton({
  label,
  onPress,
  testID,
  tone,
  disabled,
}: {
  label: string;
  onPress: () => void;
  testID: string;
  tone?: "critical" | "primary";
  disabled?: boolean;
}) {
  return (
    <Button
      look="panel"
      size="small"
      label={label}
      onPress={onPress}
      testID={testID}
      primary={tone === "primary"}
      danger={tone === "critical"}
      {...(disabled ? { disabled } : {})}
    />
  );
}

/**
 * A row of a list (SE-8): a leading mark or icon, a name 13.5 SemiBold and a
 * quieter line, then what goes at the end. A row that acts on a press is a
 * Tab stop with a role (SE-A18): an option when it can be the chosen one
 * (`chosen` given: CO-9's selection look marks it, SE-10), a button
 * otherwise. Pressable rows go in a `Group` with `list`, so the arrows move
 * between them.
 */
export function ListRow({
  testID,
  name,
  detail,
  leading,
  children,
  onPress,
  chosen,
  wrap,
  unavailable,
}: {
  testID?: string;
  name: string;
  detail?: string | undefined;
  leading?: ReactNode;
  children?: ReactNode;
  onPress?: (() => void) | undefined;
  /** Whether this row is the current one of a list you pick one from. */
  chosen?: boolean;
  /** Its line may wrap (an install command); its name never does. */
  wrap?: boolean;
  /** A choice that can't be picked now: its name muted, no press. */
  unavailable?: boolean;
}) {
  const colors = useColors();
  useCardRow(leading !== undefined);
  const picked = chosen === true;
  const pressable = onPress !== undefined && unavailable !== true;
  const role = chosen === undefined ? ("button" as const) : ("option" as const);
  return (
    <View
      testID={testID}
      onPress={pressable ? onPress : undefined}
      {...(pressable
        ? { focusable: true, accessibilityRole: role, accessibilityLabel: detail ? `${name}, ${detail}` : name, accessibilityState: { selected: picked } }
        : {})}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: SPACE.gap,
        minHeight: PAGE.row,
        paddingLeft: leading ? PAGE.knobInset : PAGE.inset,
        paddingRight: PAGE.inset,
        paddingVertical: SPACE.m,
        position: "relative",
        backgroundColor: picked ? colors.selectionWash : CLEAR,
        hoverBackgroundColor: picked ? colors.selectionWash : pressable ? colors.button : CLEAR,
        ...(pressable ? { focusRingColor: colors.focusRing } : {}),
      }}
    >
      {picked && <SelectionBar />}
      {leading}
      <View style={{ flex: 1, flexDirection: "column", gap: SPACE.px, minWidth: 0 }}>
        <Text
          numberOfLines={1}
          style={{
            fontSize: TYPE.panel.name.size,
            fontWeight: WEIGHT.semibold,
            color: picked ? colors.onSelection : unavailable ? colors.textMuted : colors.text,
          }}
        >
          {name}
        </Text>
        {detail !== undefined && (
          <Text {...(wrap ? {} : { numberOfLines: 1 })} style={{ fontSize: TYPE.panel.detail.size, color: picked ? colors.onSelection : colors.textMuted }}>
            {detail}
          </Text>
        )}
      </View>
      {children}
    </View>
  );
}

/** A plain list's glyph at a row's end, small and muted (a device's kind, a network's signal): the names keep one left edge. */
export function KindMark({ glyph }: { glyph: string }) {
  const colors = useColors();
  return <Svg markup={glyph} size={15} color={colors.textMuted} />;
}

/** A round icon, a knob: green with the tighter corner while `lit` (on, connected). */
export function RoundIcon({ glyph, lit, size = 40 }: { glyph: string; lit: boolean; size?: number }) {
  return <Knob glyph={glyph} size={size} glyphSize={Math.round(size * 0.45)} on={lit} />;
}

/**
 * A row's destructive action, confirmed in place (SE-12, PA-1): "Delete…"
 * (or the row's own verb: Forget, Remove, Delete all) turns into Cancel and
 * the verb in ume, and only that second press acts. While it asks,
 * `onAsking` lets the row say what will be lost.
 */
export function ConfirmDelete({
  testID,
  onDelete,
  onAsking,
  verb = "Delete",
  disabled,
}: {
  testID: string;
  onDelete: () => void;
  onAsking?: (asking: boolean) => void;
  verb?: string;
  disabled?: boolean;
}) {
  const [asking, setAsking] = useState(false);
  const ask = (next: boolean): void => {
    setAsking(next);
    onAsking?.(next);
  };
  return asking ? (
    <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.s }}>
      <MiniButton testID={`${testID}:cancel`} label="Cancel" onPress={() => ask(false)} />
      <MiniButton
        testID={`${testID}:confirm`}
        label={verb}
        tone="critical"
        onPress={() => {
          ask(false);
          onDelete();
        }}
      />
    </View>
  ) : (
    <MiniButton testID={testID} label={`${verb}…`} tone="critical" disabled={disabled === true} onPress={() => ask(true)} />
  );
}

/** What to try when Dashi's vault didn't do what was asked (Passwords, Payments). */
export const VAULT_TROUBLE = "Try again; if it keeps failing, log out and in again to restart Dashi's vault.";

/**
 * A failure (SE-9, PA-6): 11.5 in the critical colour, one sentence of what
 * happened and one of what to do, on the rows' 16 edge, under the card it is
 * about.
 */
export function Failure({ children, testID }: { children: string; testID: string }) {
  const colors = useColors();
  return (
    <View testID={testID} style={{ flexShrink: 0, paddingHorizontal: PAGE.inset }}>
      <Text style={{ fontSize: TYPE.panel.detail.size, color: colors.critical }}>{children}</Text>
    </View>
  );
}
