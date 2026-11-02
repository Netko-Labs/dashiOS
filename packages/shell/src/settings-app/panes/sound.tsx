/**
 * Sound: the output device and its volume, the input device (microphone) and
 * its volume with a live level meter, and whether the menu bar shows the
 * volume. The outputs are Control Center's Sound store, so a choice made in
 * either is seen in the other. The meter listens to the microphone only while
 * this pane is on screen, reads the loudness, and keeps nothing.
 */

import { useColors } from "@dashi/ui";
import { Svg, View } from "@mirinjs/metal";
import { useEffect, useRef, useState } from "react";
import { BLUETOOTH } from "../../control-center/glyphs.ts";
import { speakerGlyph } from "../../glyphs.ts";
import { DISPLAY, HEADPHONES } from "../../sound/glyphs.ts";
import { type LevelMeter, useLevels } from "../../sound/index.ts";
import { type SoundStore, useSound } from "../../sound/store.ts";
import type { Output, OutputKind } from "../../sound/types.ts";
import type { Volume } from "../../system/volume.ts";
import { Switch } from "../../wifi/switch.tsx";
import { MICROPHONE } from "../glyphs-machine.ts";
import { useSettings } from "../hooks.ts";
import type { PaneServices } from "../services.ts";
import type { SettingsStore } from "../store.ts";
import { Caption, Group, Note, Page, Row, Slider } from "../ui.tsx";
import { CheckSlot, Failure, ListRow } from "./parts.tsx";

const VOLUME = { min: 0, max: 1, step: 0.01 } as const;

const OUTPUT_GLYPH: Record<OutputKind, string> = { speaker: speakerGlyph(1, false), headphones: HEADPHONES, display: DISPLAY, bluetooth: BLUETOOTH };

function Devices({ store, side, testID }: { store: SoundStore; side: "output" | "input"; testID: string }) {
  const colors = useColors();
  const state = useSound(store);
  useEffect(() => {
    store.open();
    return () => store.close();
  }, [store]);
  const glyph = (device: Output) => (side === "input" ? (device.kind === "bluetooth" ? BLUETOOTH : MICROPHONE) : OUTPUT_GLYPH[device.kind]);
  return (
    <>
      <Group testID={testID}>
        {state.available === false ? (
          <Note>{side === "output" ? "Sound isn't available on this computer." : "Input devices aren't available on this computer."}</Note>
        ) : state.available === true && state.outputs.length === 0 ? (
          <Note>{side === "output" ? "No output devices found." : "No input devices found."}</Note>
        ) : (
          state.outputs.map((device) => (
            <ListRow
              key={device.id}
              testID={`${side}-device:${device.label}`}
              name={device.label}
              bold={device.current}
              leading={
                <>
                  <CheckSlot on={device.current} />
                  <Svg markup={glyph(device)} size={16} color={colors.text} />
                </>
              }
              onPress={device.current ? undefined : () => void store.choose(device.id)}
            />
          ))
        )}
      </Group>
      {state.failed !== null && (
        <Failure testID={`${side}-failure`}>{`Couldn’t make “${state.failed}” the ${side === "output" ? "output" : "input"}.`}</Failure>
      )}
    </>
  );
}

function VolumeRow({
  side,
  volume,
  onLevel,
  onMute,
}: {
  side: "output" | "input";
  volume: Volume | null;
  onLevel: (level: number) => void;
  onMute: (muted: boolean) => void;
}) {
  const colors = useColors();
  if (volume === null) return null;
  const shown = volume.muted ? 0 : Math.min(volume.level, 1);
  return (
    <Group testID={`${side}-volume-group`}>
      <Row label={side === "output" ? "Output volume" : "Input volume"} detail={volume.muted ? "Muted" : `${Math.round(shown * 100)}%`}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Svg markup={side === "output" ? speakerGlyph(0, false) : MICROPHONE} size={13} color={colors.textMuted} />
          <Slider testID={`${side}-volume`} value={shown} range={VOLUME} width={200} onCommit={onLevel} />
          <Svg markup={side === "output" ? speakerGlyph(1, false) : MICROPHONE} size={15} color={colors.textMuted} />
        </View>
      </Row>
      <Row label="Mute">
        <Switch testID={`${side}-mute`} on={volume.muted} onChange={onMute} />
      </Row>
    </Group>
  );
}

/** How fast a bar falls: the meter reads the loudest sample of each 100 ms, which would flicker as a bar. */
const FALL = 0.25;

function InputMeter({ meter }: { meter: LevelMeter }) {
  const colors = useColors();
  const [level, setLevel] = useState(0);
  const shown = useRef(0);
  useEffect(() => {
    const stop = meter.start((next) => {
      shown.current = Math.max(next, shown.current - FALL);
      setLevel(shown.current);
    });
    return stop;
  }, [meter]);
  const width = 200;
  return (
    <View testID="input-meter" style={{ width, height: 8, borderRadius: 4, overflow: "hidden", backgroundColor: colors.track }}>
      <View
        testID="input-meter-fill"
        style={{ width: Math.round(width * level), height: 8, borderRadius: 4, backgroundColor: level > 0.85 ? colors.critical : colors.selection }}
      />
    </View>
  );
}

export function SoundPane({ services, settings }: { services: PaneServices; settings: SettingsStore }) {
  const { levels, inputs, sound, meter } = services;
  const volumes = useLevels(levels);
  const { menuBar } = useSettings(settings).data;
  useEffect(() => {
    levels.open();
    return () => levels.close();
  }, [levels]);
  return (
    <Page title="Sound">
      <Caption above>Output</Caption>
      <Devices store={sound} side="output" testID="sound-outputs" />
      <VolumeRow
        side="output"
        volume={volumes.output}
        onLevel={(level) => void levels.setLevel("output", level)}
        onMute={(muted) => void levels.setMuted("output", muted)}
      />
      <Caption above>Input</Caption>
      <Devices store={inputs} side="input" testID="sound-inputs" />
      <VolumeRow
        side="input"
        volume={volumes.input}
        onLevel={(level) => void levels.setLevel("input", level)}
        onMute={(muted) => void levels.setMuted("input", muted)}
      />
      {volumes.input !== null && !volumes.input.muted && (
        <Group testID="input-level-group">
          <Row label="Input level" detail="Speak to see the meter move. Nothing is recorded.">
            <InputMeter meter={meter} />
          </Row>
        </Group>
      )}
      <Caption above>Menu Bar</Caption>
      <Group>
        <Row label="Show Sound in menu bar" detail="The speaker beside the battery and network icons.">
          <Switch testID="sound-menubar" on={menuBar.sound ?? true} onChange={(sound) => settings.patch("menuBar", { sound })} />
        </Row>
      </Group>
    </Page>
  );
}
