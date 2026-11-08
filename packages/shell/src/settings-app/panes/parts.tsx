/**
 * Small pieces the machine panes (Network, Bluetooth, Sound, Battery & Power,
 * Users & Accounts) share beyond ui.tsx's: a value at the end of a row, a
 * compact button, a pressable list row, a round icon, a Delete that asks
 * first, and a failure's sentence.
 */

import { CHECK } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import { type ReactNode, useState } from "react";
import { PillButton } from "../../shared/controls/inputs.tsx";
import { Knob } from "../../shared/controls/parts.tsx";
import { useColors } from "../colors.ts";
import { useCardRow } from "../row.tsx";

/** A value at the end of a row, muted and right-aligned (several lines stack). */
export function Value({ children, testID }: { children: string | readonly string[]; testID?: string }) {
  const colors = useColors();
  const lines = typeof children === "string" ? [children] : children;
  return (
    <View testID={testID} style={{ flexShrink: 1, flexDirection: "column", alignItems: "flex-end", minWidth: 0 }}>
      {lines.map((line, index) => (
        // Lines of a value never reorder.
        <Text key={index} numberOfLines={1} style={{ fontSize: 12.5, color: colors.textMuted, textAlign: "right" }}>
          {line}
        </Text>
      ))}
    </View>
  );
}

/** A compact button for a row: Join, Forget, Connect; a small pill in Control Center's language. */
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
    <PillButton
      small
      label={label}
      onPress={onPress}
      testID={testID}
      tone={tone === "critical" ? "danger" : tone === "primary" ? "ink" : "plain"}
      {...(disabled ? { disabled } : {})}
    />
  );
}

/** A row of a list: a leading mark or icon, a name and a quieter line, then what goes at the end. Pressing it is optional. */
export function ListRow({
  testID,
  name,
  detail,
  leading,
  children,
  onPress,
  bold,
}: {
  testID?: string;
  name: string;
  detail?: string | undefined;
  leading?: ReactNode;
  children?: ReactNode;
  onPress?: (() => void) | undefined;
  bold?: boolean;
}) {
  const colors = useColors();
  useCardRow(leading !== undefined);
  return (
    <View
      testID={testID}
      onPress={onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        minHeight: 56,
        paddingLeft: leading ? 8 : 16,
        paddingRight: 16,
        paddingVertical: 8,
        hoverBackgroundColor: onPress ? colors.button : "#00000000",
      }}
    >
      {leading}
      <View style={{ flex: 1, flexDirection: "column", gap: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 13.5, fontWeight: bold ? "semibold" : "normal", color: colors.text }}>
          {name}
        </Text>
        {detail !== undefined && (
          <Text numberOfLines={1} style={{ fontSize: 11.5, color: colors.textMuted }}>
            {detail}
          </Text>
        )}
      </View>
      {children}
    </View>
  );
}

/** A check in a fixed-width slot, so names line up whether or not they are chosen. */
export function CheckSlot({ on }: { on: boolean }) {
  const colors = useColors();
  return <View style={{ width: 16, alignItems: "center" }}>{on && <Svg markup={CHECK} size={13} color={colors.selection} />}</View>;
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
 * A row's Delete that asks first, in place, as Network's Forget does: "Delete…"
 * turns into Cancel and Delete, and only that second press deletes. While it
 * asks, `onAsking` lets the row say what will be lost.
 */
export function ConfirmDelete({ testID, onDelete, onAsking }: { testID: string; onDelete: () => void; onAsking?: (asking: boolean) => void }) {
  const [asking, setAsking] = useState(false);
  const ask = (next: boolean): void => {
    setAsking(next);
    onAsking?.(next);
  };
  return asking ? (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <MiniButton testID={`${testID}:cancel`} label="Cancel" onPress={() => ask(false)} />
      <MiniButton
        testID={`${testID}:confirm`}
        label="Delete"
        tone="critical"
        onPress={() => {
          ask(false);
          onDelete();
        }}
      />
    </View>
  ) : (
    <MiniButton testID={testID} label="Delete…" tone="critical" onPress={() => ask(true)} />
  );
}

/** What to try when Dashi's vault didn't do what was asked (Passwords, Payments). */
export const VAULT_TROUBLE = "Try again; if it keeps failing, log out and in again to restart Dashi's vault.";

/** A sentence for a failure, in the critical color, under a group. */
export function Failure({ children, testID }: { children: string; testID: string }) {
  const colors = useColors();
  return (
    <View testID={testID} style={{ flexShrink: 0, paddingHorizontal: 10 }}>
      <Text style={{ fontSize: 11.5, color: colors.critical }}>{children}</Text>
    </View>
  );
}
