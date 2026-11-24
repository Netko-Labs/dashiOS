/**
 * The one status chip (UI-12): a state in a few words, never a control. 18
 * tall, a pill, 11 SemiBold on its tone's wash ("Connected" on the agents'
 * wash); in a toolbar it is VS-5's 24, 12 SemiBold. A tone says the job:
 * neutral, an agent's, a failure (ume), a caution (broth), done (moss words
 * on the neutral wash: done is not "on").
 */

import { Svg, Text, View } from "@mirinjs/metal";
import { pill, SPACE, TYPE, useColors, WEIGHT } from "./theme/index.ts";
import type { Palette } from "./theme/palette.ts";

export type ChipTone = "neutral" | "agent" | "danger" | "warning" | "success";

/** Its measures: the two heights, the inset, a glyph and its gap. */
export const CHIP = { height: 18, toolbarHeight: 24, inset: SPACE.s + SPACE.px, toolbarInset: SPACE.gap, glyph: 11, toolbarGlyph: 13, gap: SPACE.xs } as const;

/** A tone's wash and words. */
export function chipColors(tone: ChipTone, colors: Palette): { wash: string; ink: string } {
  switch (tone) {
    case "agent":
      return { wash: colors.agentWash, ink: colors.agentInk };
    case "danger":
      return { wash: colors.umeWash, ink: colors.ume };
    case "warning":
      return { wash: colors.brothWash, ink: colors.broth };
    case "success":
      return { wash: colors.button, ink: colors.moss };
    case "neutral":
      return { wash: colors.button, ink: colors.textMuted };
  }
}

export function Chip({
  label,
  tone = "neutral",
  size = "status",
  glyph,
  testID,
}: {
  label: string;
  tone?: ChipTone;
  /** "toolbar": VS-5's 24-tall chip in a window's controls row. */
  size?: "status" | "toolbar";
  glyph?: string;
  testID?: string;
}) {
  const colors = useColors();
  const { wash, ink } = chipColors(tone, colors);
  const toolbar = size === "toolbar";
  const height = toolbar ? CHIP.toolbarHeight : CHIP.height;
  return (
    <View
      testID={testID}
      accessibilityLabel={label}
      style={{
        height,
        flexShrink: 0,
        alignSelf: "flex-start",
        flexDirection: "row",
        alignItems: "center",
        gap: CHIP.gap,
        paddingHorizontal: toolbar ? CHIP.toolbarInset : CHIP.inset,
        borderRadius: pill(height),
        backgroundColor: wash,
      }}
    >
      {glyph !== undefined && <Svg markup={glyph} size={toolbar ? CHIP.toolbarGlyph : CHIP.glyph} color={ink} />}
      <Text numberOfLines={1} style={{ fontSize: toolbar ? TYPE.secondary.size : TYPE.caption.size, fontWeight: WEIGHT.semibold, color: ink }}>
        {label}
      </Text>
    </View>
  );
}
