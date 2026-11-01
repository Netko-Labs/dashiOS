/** The speed rows the Trackpad and Mouse panes share: sliders from slow to fast, for tracking and for scrolling. */

import { Text, View } from "@mirinjs/metal";
import { useColors } from "@dashi/ui";
import { scrollSpeedAt, scrollSpeedPosition } from "../../scroll-speed.ts";
import { type Range, SCROLL_POSITION, SPEED } from "../controls.ts";
import { Row, Slider } from "../ui.tsx";

export function SpeedRow({
  value,
  testID,
  onCommit,
  label = "Tracking speed",
  range = SPEED,
}: {
  value: number;
  testID: string;
  onCommit: (value: number) => void;
  label?: string;
  range?: Range;
}) {
  const colors = useColors();
  return (
    <Row label={label}>
      <View style={{ flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
        <Slider testID={testID} value={value} range={range} onCommit={onCommit} />
        <View style={{ flexDirection: "row", justifyContent: "space-between", width: 220 }}>
          <Text style={{ fontSize: 10, color: colors.textMuted }}>Slow</Text>
          <Text style={{ fontSize: 10, color: colors.textMuted }}>Fast</Text>
        </View>
      </View>
    </Row>
  );
}

/**
 * How far a scroll goes, as the factor in settings.json (scroll-speed.ts):
 * the slider is logarithmic, so the middle is 1 and Slow and Fast are a
 * quarter and four times. The middle clears the setting instead of saving 1.
 */
export function ScrollSpeedRow({ value, testID, onCommit }: { value: number | undefined; testID: string; onCommit: (factor: number | undefined) => void }) {
  return (
    <SpeedRow
      label="Scrolling speed"
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
