/**
 * Control Center's Sound page, grown out of the volume slider
 * (control-center/page-parts.tsx): the header names the output in use, the
 * volume lies flat under it, then the outputs, the one in use chosen (green).
 * Choosing another makes it the default. The list is read again while the
 * page is open, so a headset plugged in appears on its own.
 */

import { View } from "@mirinjs/metal";
import { type ReactNode, useEffect } from "react";
import { percentText } from "../control-center/catalog.ts";
import { BLUETOOTH } from "../control-center/glyphs.ts";
import { GRID } from "../control-center/layout.ts";
import { PageBody, PageHeader, PageNote, PageRow, PageSection } from "../control-center/page-parts.tsx";
import { SliderTile } from "../control-center/tiles.tsx";
import { speakerGlyph } from "../glyphs.ts";
import type { Volume } from "../system/volume.ts";
import { DISPLAY, HEADPHONES } from "./glyphs.ts";
import { type SoundStore, useSound } from "./store.ts";
import type { OutputKind } from "./types.ts";

const GLYPH: Record<OutputKind, string> = {
  speaker: speakerGlyph(1, false),
  headphones: HEADPHONES,
  display: DISPLAY,
  bluetooth: BLUETOOTH,
};

export interface SoundPageProps {
  sound: SoundStore;
  /** The output volume; null without PipeWire, when there is no slider. */
  volume: Volume | null;
  /** Sets the output volume, 0 to 1. */
  onVolume: (level: number) => void;
  onBack: () => void;
}

export function SoundPage({ sound, volume, onVolume, onBack }: SoundPageProps) {
  const state = useSound(sound);
  useEffect(() => {
    sound.open();
    return () => sound.close();
  }, [sound]);

  const list = (): ReactNode => {
    if (state.available === false) return <PageNote>Sound isn't available on this computer</PageNote>;
    if (state.available === true && state.outputs.length === 0) return <PageNote>No outputs found</PageNote>;
    return state.outputs.map((output) => (
      <PageRow
        key={output.id}
        testID={`sound-row:${output.id}`}
        label={output.label}
        glyph={GLYPH[output.kind]}
        checked={output.current}
        {...(output.current ? {} : { onPress: () => void sound.choose(output.id) })}
      />
    ));
  };
  const current = state.outputs.find((output) => output.current);

  return (
    <>
      <PageHeader testID="sound-header" title="Sound" detail={current?.label ?? null} on={false} onBack={onBack} />
      <PageBody testID="sound-list">
        {volume !== null && (
          <View testID="sound-volume-tile" style={{ height: GRID.row, flexDirection: "column" }}>
            <SliderTile
              look={{
                testID: "sound-volume",
                title: "Volume",
                glyph: speakerGlyph(volume.level, volume.muted),
                level: volume.muted ? 0 : volume.level,
                value: volume.muted ? "Muted" : percentText(volume.level),
                width: GRID.width - 2 * GRID.padding,
                height: GRID.row,
              }}
              standing={false}
              onLevel={onVolume}
            />
          </View>
        )}
        <PageSection>Output</PageSection>
        {list()}
        {state.failed !== null && <PageNote testID="sound-failure" tone="critical">{`Couldn’t make “${state.failed}” the output.`}</PageNote>}
      </PageBody>
    </>
  );
}
