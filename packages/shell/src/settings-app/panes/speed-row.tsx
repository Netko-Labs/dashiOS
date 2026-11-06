/** The speed rows the Trackpad and Mouse panes share: sliders from slow to fast, for tracking and for scrolling. */

import { useColors } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { scrollSpeedAt, scrollSpeedPosition } from "../../scroll-speed.ts";
import { type Range, SCROLL_POSITION, SPEED } from "../controls.ts";
import type { SettingId } from "../registry/index.ts";
import { Setting, Slider } from "../ui.tsx";

export function SpeedRow({
  id,
  value,
  testID,
  onCommit,
  range = SPEED,
}: {
  /** The registry's row: its title is the label. */
  id: SettingId;
  value: number;
  testID: string;
  onCommit: (value: number) => void;
  range?: Range;
}) {
  const colors = useColors();
  return (
    <Setting id={id}>
      <View style={{ flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
        <Slider testID={testID} value={value} range={range} onCommit={onCommit} />
        <View style={{ flexDirection: "row", justifyContent: "space-between", width: 220 }}>
          <Text style={{ fontSize: 10, color: colors.textMuted }}>Slow</Text>
          <Text style={{ fontSize: 10, color: colors.textMuted }}>Fast</Text>
        </View>
      </View>
    </Setting>
  );
}

/**
 * How far a scroll goes, as the factor in settings.json (scroll-speed.ts):
 * the slider is logarithmic, so the middle is 1 and Slow and Fast are a
 * quarter and four times. The middle clears the setting instead of saving 1.
 */
export function ScrollSpeedRow({
  id,
  value,
  testID,
  onCommit,
}: {
  id: SettingId;
  value: number | undefined;
  testID: string;
  onCommit: (factor: number | undefined) => void;
}) {
  return (
    <SpeedRow
      id={id}
      testID={testID}
      value={scrollSpeedPosition(value ?? 1)}
      range={SCROLL_POSITION}
      onCommit={(position) => {
        const factor = scrollSpeedAt(position);
        onCommit(factor === 1 ? undefined : factor);
      }}
    />
  );
}
