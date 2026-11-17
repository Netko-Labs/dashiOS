/**
 * The accent's live preview, under its row (the accent's design frame 1):
 * Dashi's real controls, drawn by @dashi/ui with the palette every app paints
 * with, so it shows what a pick does before anything else is opened: a list
 * with its selected row, selected text, switches, a tick, a radio, a slider,
 * a chosen pill, a menu highlight, progress, a link, and an ink Save button
 * ("Buttons stay ink"). Nothing in it does anything.
 */

import { Button, CHECK, Choices, MenuRow, ProgressBar, rowLook, SelectionBar, Slider, Switch, useColors } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import { type ReactNode, useState } from "react";
import { useControlColors } from "../../../shared/controls/palette.ts";

const COLUMN = { flex: 1, minWidth: 0, flexDirection: "column", gap: 10, padding: 12, borderRadius: 16 } as const;

function Column({ children, testID, grow = 1 }: { children: ReactNode; testID: string; grow?: number }) {
  const surface = useControlColors();
  return (
    <View style={{ ...COLUMN, flex: grow, backgroundColor: surface.surface }} testID={testID}>
      {children}
    </View>
  );
}

function ListRow({ label, selected }: { label: string; selected: boolean }) {
  const colors = useColors();
  const look = rowLook(colors, selected);
  return (
    <View style={{ height: 28, flexDirection: "row", alignItems: "center", paddingLeft: 10, borderRadius: 6, backgroundColor: look.ground }}>
      {selected && <SelectionBar rowHeight={28} />}
      <Text numberOfLines={1} style={{ fontSize: 12.5, color: look.ink }}>
        {label}
      </Text>
    </View>
  );
}

/** "Dinner at Alex Kim's", the name selected as a field selects it. */
function SelectedText() {
  const colors = useColors();
  return (
    <View style={{ height: 28, flexDirection: "row", alignItems: "center", paddingHorizontal: 8, borderRadius: 6, backgroundColor: colors.button }}>
      <View style={{ flexShrink: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 12.5, color: colors.text }}>
          Dinner at{" "}
        </Text>
      </View>
      <View style={{ flexShrink: 0, backgroundColor: colors.textSelection, borderRadius: 2 }}>
        <Text numberOfLines={1} style={{ fontSize: 12.5, color: colors.text }}>
          Alex Kim's
        </Text>
      </View>
    </View>
  );
}

function Tick({ label, round }: { label: string; round?: boolean }) {
  const colors = useColors();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
      <View style={{ width: 16, height: 16, borderRadius: round ? 8 : 4, alignItems: "center", justifyContent: "center", backgroundColor: colors.selection }}>
        {round ? (
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.onAccent }} />
        ) : (
          <Svg markup={CHECK} size={11} color={colors.onAccent} />
        )}
      </View>
      <Text style={{ fontSize: 12.5, color: colors.text }}>{label}</Text>
    </View>
  );
}

const SPAN = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
] as const;

export function AccentPreview() {
  const colors = useColors();
  const [span, setSpan] = useState<string>("week");
  return (
    <View testID="accent-preview" style={{ flexDirection: "row", gap: 10 }}>
      <Column testID="accent-preview-list">
        <ListRow label="Documents" selected={false} />
        <ListRow label="Pictures" selected />
        <ListRow label="Kitchen list.md" selected={false} />
        <SelectedText />
      </Column>
      <Column testID="accent-preview-controls" grow={1.3}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Switch on testID="accent-preview-on" focusable={false} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 12.5, color: colors.text }}>Wi-Fi</Text>
          </View>
          <Switch on={false} testID="accent-preview-off" focusable={false} />
        </View>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Tick label="Keep a copy" />
          <Tick label="Daily" round />
        </View>
        <Slider value={0.62} testID="accent-preview-slider" width={180} />
        <Choices options={SPAN} value={span} onChange={setSpan} testID="accent-preview-span" />
      </Column>
      <Column testID="accent-preview-more">
        <MenuRow label="Open in Notes" testID="accent-preview-menu" keys="❖O" ticks={false} lit />
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Text style={{ fontSize: 12, color: colors.text }}>Copying 41 files</Text>
          <Text style={{ fontSize: 11, color: colors.textMuted }}>62%</Text>
        </View>
        <ProgressBar value={0.62} testID="accent-preview-progress" />
        <View style={{ flexDirection: "row", gap: 4 }}>
          <Text style={{ fontSize: 12, color: colors.text }}>Read the</Text>
          <Text style={{ fontSize: 12, color: colors.accentInk, textDecorationLine: "underline" }}>release notes</Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Button label="Save" primary onPress={() => {}} testID="accent-preview-save" focusable={false} />
          <View style={{ flexShrink: 1 }}>
            <Text style={{ fontSize: 11, color: colors.textMuted }}>Buttons stay ink</Text>
          </View>
        </View>
      </Column>
    </View>
  );
}
