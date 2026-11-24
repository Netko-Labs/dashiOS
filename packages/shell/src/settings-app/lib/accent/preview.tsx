/**
 * The accent's live preview, under its row (the accent's design frame 1):
 * Dashi's real controls, drawn by @dashi/ui with the palette every app paints
 * with, so it shows what a pick does before anything else is opened: a list
 * with its selected row, selected text, switches, a tick, a slider, a chosen
 * pill, a menu highlight, and what stays ink whatever the pick (Q3): progress,
 * a link and the Save button. Nothing in it does anything.
 */

import {
  Button,
  Checkbox,
  Choices,
  MenuRow,
  ProgressBar,
  RADIUS,
  rowLook,
  SelectionBar,
  Slider,
  SPACE,
  Switch,
  TextLink,
  TYPE,
  useColors,
  useControlColors,
} from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { type ReactNode, useState } from "react";

const COLUMN = { flex: 1, minWidth: 0, flexDirection: "column", gap: SPACE.gap, padding: SPACE.inset, borderRadius: RADIUS.sheet } as const;
/** A row of the preview's list, and its slider. */
const PREVIEW = { row: 28, slider: 180 } as const;
const noop = (): void => {};

function Column({ children, testID, grow = 1 }: { children: ReactNode; testID: string; grow?: number }) {
  const surface = useControlColors();
  return (
    <View style={{ ...COLUMN, flex: grow, backgroundColor: surface.surface }} testID={testID}>
      {children}
    </View>
  );
}

function PreviewRow({ label, selected }: { label: string; selected: boolean }) {
  const colors = useColors();
  const look = rowLook(colors, selected);
  return (
    <View
      style={{
        height: PREVIEW.row,
        flexDirection: "row",
        alignItems: "center",
        paddingLeft: SPACE.gap,
        borderRadius: RADIUS.row,
        backgroundColor: look.ground,
      }}
    >
      {selected && <SelectionBar rowHeight={PREVIEW.row} />}
      <Text numberOfLines={1} style={{ fontSize: TYPE.body.size, color: look.ink }}>
        {label}
      </Text>
    </View>
  );
}

/** "Dinner at Alex Kim's", the name selected as a field selects it. */
function SelectedText() {
  const colors = useColors();
  return (
    <View
      style={{
        height: PREVIEW.row,
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: SPACE.m,
        borderRadius: RADIUS.control,
        backgroundColor: colors.button,
      }}
    >
      <View style={{ flexShrink: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: TYPE.body.size, color: colors.text }}>
          Dinner at{" "}
        </Text>
      </View>
      <View style={{ flexShrink: 0, backgroundColor: colors.textSelection, borderRadius: RADIUS.thumb }}>
        <Text numberOfLines={1} style={{ fontSize: TYPE.body.size, color: colors.text }}>
          Alex Kim's
        </Text>
      </View>
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
    <View testID="accent-preview" style={{ flexDirection: "row", gap: SPACE.gap }}>
      <Column testID="accent-preview-list">
        <PreviewRow label="Documents" selected={false} />
        <PreviewRow label="Pictures" selected />
        <PreviewRow label="Kitchen list.md" selected={false} />
        <SelectedText />
      </Column>
      <Column testID="accent-preview-controls" grow={1.3}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.m }}>
          <Switch on testID="accent-preview-on" focusable={false} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: TYPE.body.size, color: colors.text }}>Wi-Fi</Text>
          </View>
          <Switch on={false} testID="accent-preview-off" focusable={false} />
        </View>
        <Checkbox testID="accent-preview-tick" label="Keep a copy" checked onChange={noop} />
        <Slider value={0.62} testID="accent-preview-slider" width={PREVIEW.slider} />
        <Choices options={SPAN} value={span} onChange={setSpan} testID="accent-preview-span" />
      </Column>
      <Column testID="accent-preview-more">
        <MenuRow label="Open in Notes" testID="accent-preview-menu" keys="❖O" ticks={false} lit />
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Text style={{ fontSize: TYPE.secondary.size, color: colors.text }}>Copying 41 files</Text>
          <Text style={{ fontSize: TYPE.caption.size, color: colors.textMuted }}>62%</Text>
        </View>
        <ProgressBar value={0.62} testID="accent-preview-progress" />
        <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.xs }}>
          <Text style={{ fontSize: TYPE.secondary.size, color: colors.text }}>Read the</Text>
          <TextLink testID="accent-preview-link" label="release notes" onPress={noop} />
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.m }}>
          <Button label="Save" primary onPress={noop} testID="accent-preview-save" focusable={false} />
          <View style={{ flexShrink: 1 }}>
            <Text style={{ fontSize: TYPE.caption.size, color: colors.textMuted }}>Buttons and links stay ink</Text>
          </View>
        </View>
      </Column>
    </View>
  );
}
