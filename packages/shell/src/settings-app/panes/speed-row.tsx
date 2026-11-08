/** The speed rows the Trackpad and Mouse panes share: sliders from slow to fast, for tracking and for scrolling. */

import { scrollSpeedAt, scrollSpeedPosition } from "../../scroll-speed.ts";
import { type Range, SCROLL_POSITION, SPEED } from "../controls.ts";
import { POINTER, SCROLL } from "../knob-glyphs.ts";
import type { SettingId } from "../registry/index.ts";
import { Setting, Slider } from "../ui.tsx";

/** A tracking speed in words: libinput's neutral 0 is the default, below it slower, above faster. */
export function trackingWords(speed: number): string {
  if (Math.abs(speed) < 0.001) return "Default";
  return speed < 0 ? "Slower" : "Faster";
}

export function SpeedRow({
  id,
  value,
  testID,
  onCommit,
  range = SPEED,
  glyph = POINTER,
  format = trackingWords,
}: {
  /** The registry's row: its title is the label. */
  id: SettingId;
  value: number;
  testID: string;
  onCommit: (value: number) => void;
  range?: Range;
  glyph?: string;
  /** What the value reads at the slider's right. */
  format?: (value: number) => string;
}) {
  return (
    <Setting id={id} glyph={glyph} detail="Slow at the left, fast at the right.">
      <Slider testID={testID} value={value} range={range} glyph={glyph} format={format} onCommit={onCommit} />
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
      glyph={SCROLL}
      format={(position) => `${Math.round(scrollSpeedAt(position) * 100) / 100}×`}
      onCommit={(position) => {
        const factor = scrollSpeedAt(position);
        onCommit(factor === 1 ? undefined : factor);
      }}
    />
  );
}
