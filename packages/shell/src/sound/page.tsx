/**
 * Control Center's Sound page, laid out the way macOS's is: a back arrow, the
 * output volume (the Sound card's own slider), then the outputs, with a check
 * on the default. Clicking an output makes it the default. The list is read
 * again while the page is open, so a headset plugged in appears on its own.
 */

import { CHECK, useColors } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import { type ReactNode, useEffect } from "react";
import { BLUETOOTH, CHEVRON_LEFT } from "../control-center/glyphs.ts";
import { Slider } from "../control-center/slider.tsx";
import { speakerGlyph } from "../glyphs.ts";
import type { Volume } from "../system/volume.ts";
import { DISPLAY, HEADPHONES } from "./glyphs.ts";
import { type SoundStore, useSound } from "./store.ts";
import type { Output, OutputKind } from "./types.ts";

const GLYPH: Record<OutputKind, string> = {
  speaker: speakerGlyph(1, false),
  headphones: HEADPHONES,
  display: DISPLAY,
  bluetooth: BLUETOOTH,
};

function Row({ output, onChoose }: { output: Output; onChoose: (id: number) => void }) {
  const colors = useColors();
  return (
    <View
      testID={`sound-row:${output.id}`}
      onPress={output.current ? undefined : () => onChoose(output.id)}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        height: 30,
        paddingLeft: 6,
        paddingRight: 10,
        borderRadius: 8,
        hoverBackgroundColor: colors.button,
      }}
    >
      <View style={{ width: 16, alignItems: "center" }}>{output.current && <Svg markup={CHECK} size={13} color={colors.text} />}</View>
      <Svg markup={GLYPH[output.kind]} size={15} color={colors.text} />
      <View style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
        <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: output.current ? "semibold" : "normal", color: colors.text }}>
          {output.label}
        </Text>
      </View>
    </View>
  );
}

function Note({ children }: { children: string }) {
  const colors = useColors();
  return (
    <View style={{ height: 56, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ fontSize: 12, color: colors.textMuted }}>{children}</Text>
    </View>
  );
}

function Tile({ testID, children }: { testID?: string; children: ReactNode }) {
  const colors = useColors();
  return (
    <View testID={testID} style={{ flexDirection: "column", padding: 10, borderRadius: 12, backgroundColor: colors.tile }}>
      {children}
    </View>
  );
}

export interface SoundPageProps {
  sound: SoundStore;
  /** The output volume; null without PipeWire, when there is no slider. */
  volume: Volume | null;
  /** Sets the output volume, 0 to 1. */
  onVolume: (level: number) => void;
  /** The slider's width, the same as the Sound card's. */
  sliderWidth: number;
  onBack: () => void;
}

export function SoundPage({ sound, volume, onVolume, sliderWidth, onBack }: SoundPageProps) {
  const colors = useColors();
  const state = useSound(sound);
  useEffect(() => {
    sound.open();
    return () => sound.close();
  }, [sound]);

  const list = (): ReactNode => {
    if (state.available === false) return <Note>Sound isn't available on this computer</Note>;
    if (state.available === true && state.outputs.length === 0) return <Note>No outputs found</Note>;
    return state.outputs.map((output) => <Row key={output.id} output={output} onChoose={(id) => void sound.choose(id)} />);
  };

  return (
    <>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4, height: 28 }}>
        <View
          testID="sound-back"
          onPress={onBack}
          style={{ width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", hoverBackgroundColor: colors.button }}
        >
          <Svg markup={CHEVRON_LEFT} size={14} color={colors.text} />
        </View>
        <Text style={{ fontSize: 14, fontWeight: "bold", color: colors.text }}>Sound</Text>
      </View>
      {volume !== null && (
        <Tile testID="sound-volume-tile">
          <Slider
            testID="sound-volume"
            width={sliderWidth}
            value={volume.muted ? 0 : volume.level}
            glyph={speakerGlyph(volume.level, volume.muted)}
            onChange={onVolume}
          />
        </Tile>
      )}
      <View style={{ paddingLeft: 8, paddingTop: 6, paddingBottom: 2 }}>
        <Text style={{ fontSize: 11, fontWeight: "semibold", color: colors.textMuted }}>Output</Text>
      </View>
      <View testID="sound-list" style={{ flexDirection: "column", padding: 4, borderRadius: 12, backgroundColor: colors.tile }}>
        {list()}
      </View>
      {state.failed !== null && (
        <View testID="sound-failure" style={{ paddingLeft: 6 }}>
          <Text style={{ fontSize: 11, color: colors.critical }}>{`Couldn’t make “${state.failed}” the output.`}</Text>
        </View>
      )}
    </>
  );
}
