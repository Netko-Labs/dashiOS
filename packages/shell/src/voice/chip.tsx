/**
 * The menu bar's voice chip (docs/design.html, "The voice chip"): one pill in
 * the agents' purple, in the room between the app's menus and the status
 * side, and nowhere else. It is laid over the bar, not in its row, so it
 * moves nothing: the menus and the status items stay where they are. It
 * shows that Dashi listens (with the microphone's level and the words as
 * they are heard), thinks, and speaks (the line being said, each word
 * lighting as it is said), or one sentence on what is missing. A press stops
 * Dashi, or goes where a notice points.
 */

import { useColors } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import { useEffect, useState, useSyncExternalStore } from "react";
import { MIC, SPARK, VOLUME } from "../shared/settings/index.ts";
import type { LevelStore } from "./lib/speech.ts";
import type { Chip, ChipGo } from "./types.ts";

/** The chip's measures: the agent mark's height; at most 440 wide, and never under 150. */
export const VOICE_CHIP = { height: 22, padding: 8, gap: 6, glyph: 13, fontSize: 12, maxWidth: 440, minWidth: 150, margin: 12, bars: 5, bar: 2.5 } as const;

/** What the bar's chip reads: the voice controller (voice.ts). */
export interface ChipSource {
  subscribe(listener: () => void): () => void;
  getSnapshot(): Chip | null;
  level: Pick<LevelStore, "subscribe" | "getSnapshot">;
  stop(): void;
  go(where: ChipGo): void;
}

/**
 * Where the chip goes in a bar `bar` wide whose menus take `menus` from the
 * left and whose status side takes `status` from the right (each with the
 * bar's own 6 at its edge): centred in the room between them, as wide as
 * that room up to 440. With less than 150 of room it keeps 150, centred on
 * the room, over its neighbours' edges, for as long as it shows.
 */
export function chipPlace(bar: number, menus: number, status: number): { left: number; width: number } {
  const from = 6 + menus + VOICE_CHIP.margin;
  const to = bar - 6 - status - VOICE_CHIP.margin;
  const width = Math.min(VOICE_CHIP.maxWidth, Math.max(VOICE_CHIP.minWidth, to - from));
  const left = (from + to) / 2 - width / 2;
  return { left: Math.max(6, Math.min(left, bar - 6 - width)), width };
}

/** What a screen reader says for the chip. */
export function chipLabel(chip: Chip): string {
  switch (chip.kind) {
    case "listening":
      return chip.text ? `Dashi is listening: ${chip.text}` : "Dashi is listening";
    case "thinking":
      return chip.text ? `Dashi is thinking about: ${chip.text}. Stop` : "Dashi is thinking. Stop";
    case "speaking":
      return `Dashi says: ${chip.full} Stop`;
    case "notice":
      return chip.text;
  }
}

/** The bars' heights, low at the sides: 3 at rest, up to 14 at the loudest. */
export const barHeights = (level: number): number[] =>
  [0.45, 0.8, 1, 0.8, 0.45].map((weight) => Math.round((3 + 11 * Math.min(1, Math.max(0, level)) * weight) * 2) / 2);

function Meter({ level }: { level: ChipSource["level"] }) {
  const colors = useColors();
  const now = useSyncExternalStore(level.subscribe, level.getSnapshot);
  return (
    <View testID="voice-meter" style={{ flexShrink: 0, flexDirection: "row", alignItems: "center", gap: 2, height: 14 }}>
      {barHeights(now).map((height, index) => (
        // The bars never reorder.
        <View key={index} style={{ width: VOICE_CHIP.bar, height, borderRadius: VOICE_CHIP.bar / 2, backgroundColor: colors.agent }} />
      ))}
    </View>
  );
}

/** Three dots, one lit in turn; still with Reduce Motion. */
function Dots({ still }: { still: boolean }) {
  const colors = useColors();
  const [lit, setLit] = useState(0);
  useEffect(() => {
    if (still) return;
    const timer = setInterval(() => setLit((now) => (now + 1) % 3), 320);
    return () => clearInterval(timer);
  }, [still]);
  return (
    <View testID="voice-dots" style={{ flexShrink: 0, flexDirection: "row", alignItems: "center", gap: 3 }}>
      {[0, 1, 2].map((dot) => (
        <View key={dot} style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: colors.agent, opacity: still || dot === lit ? 1 : 0.35 }} />
      ))}
    </View>
  );
}

function Words({ chip, still, level }: { chip: Chip; still: boolean; level: ChipSource["level"] }) {
  const colors = useColors();
  const text = { fontSize: VOICE_CHIP.fontSize, color: colors.agentInk } as const;
  const glyph = (markup: string) => <Svg markup={markup} size={VOICE_CHIP.glyph} color={colors.agent} />;
  if (chip.kind === "listening") {
    return (
      <>
        {glyph(MIC)}
        <Meter level={level} />
        <Text numberOfLines={1} style={{ ...text, fontWeight: chip.text ? "normal" : "semibold" }}>
          {chip.text || (chip.question ? "Listening for your answer" : "Listening")}
        </Text>
      </>
    );
  }
  if (chip.kind === "thinking") {
    return (
      <>
        {glyph(SPARK)}
        <Text numberOfLines={1} style={text}>
          {chip.text || "Thinking"}
        </Text>
        <Dots still={still} />
      </>
    );
  }
  if (chip.kind === "speaking") {
    const said = chip.words.slice(0, chip.said).join(" ");
    const coming = chip.words.slice(chip.said).join(" ");
    return (
      <>
        {glyph(VOLUME)}
        {said !== "" && (
          <Text numberOfLines={1} style={{ ...text, fontWeight: "semibold" }}>
            {said}
          </Text>
        )}
        {coming !== "" && (
          <Text numberOfLines={1} style={{ ...text, opacity: 0.6 }}>
            {coming}
          </Text>
        )}
      </>
    );
  }
  return (
    <Text numberOfLines={1} style={{ ...text, fontWeight: "semibold" }}>
      {chip.text}
    </Text>
  );
}

export interface VoiceChipProps {
  voice: ChipSource;
  /** The bar's width, its menus' and its status side's, as measured; null until they are. */
  bar: number | null;
  menus: number | null;
  status: number | null;
  reduceMotion?: () => boolean;
}

export function VoiceChip({ voice, bar, menus, status, reduceMotion = () => false }: VoiceChipProps) {
  const colors = useColors();
  const chip = useSyncExternalStore(voice.subscribe, voice.getSnapshot);
  if (!chip || bar === null || menus === null) return null;
  const place = chipPlace(bar, menus, status ?? 0);
  const press = () => {
    if (chip.kind === "notice") {
      if (chip.go) voice.go(chip.go);
      return;
    }
    voice.stop();
  };
  return (
    <View
      testID="voice-chip-room"
      style={{
        position: "absolute",
        top: 0,
        bottom: 0,
        left: place.left,
        width: place.width,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* The bar's own color under the wash: over a neighbour's edge it still reads. */}
      <View style={{ flexShrink: 1, minWidth: 0, borderRadius: VOICE_CHIP.height / 2, backgroundColor: colors.menuBar }}>
        <View
          testID={`voice-chip:${chip.kind}`}
          onPress={press}
          accessibilityRole="button"
          accessibilityLabel={chipLabel(chip)}
          style={{
            flexShrink: 1,
            minWidth: 0,
            overflow: "hidden",
            flexDirection: "row",
            alignItems: "center",
            gap: VOICE_CHIP.gap,
            height: VOICE_CHIP.height,
            paddingLeft: VOICE_CHIP.padding,
            paddingRight: VOICE_CHIP.padding + 2,
            borderRadius: VOICE_CHIP.height / 2,
            backgroundColor: colors.agentWash,
          }}
        >
          <Words chip={chip} still={reduceMotion()} level={voice.level} />
        </View>
      </View>
    </View>
  );
}
