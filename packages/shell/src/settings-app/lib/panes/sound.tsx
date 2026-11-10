/**
 * Sound: the output device and its volume, the input device (microphone) and
 * its volume with a live level meter, and whether the menu bar shows the
 * volume. The outputs are Control Center's Sound store, so a choice made in
 * either is seen in the other. The devices are a plain list: their names,
 * the one in use in SemiBold with an ink tick, no knobs. With no
 * microphone, the input is one row that says so, and none of its controls
 * (a slider for a microphone that isn't there would say there is one). The
 * meter listens to the microphone only while this pane is on screen, reads
 * the loudness, and keeps nothing. Each app's volume, mute and output are
 * the Apps card under the output's volume, and the apps using the
 * microphone a card under the input (sound-apps.tsx). The title's detail is
 * the output in use (VS-2).
 */

import { CHECK } from "@dashi/ui";
import { Svg, View } from "@mirinjs/metal";
import { useEffect, useRef, useState } from "react";
import { speakerGlyph } from "../../../glyphs.ts";
import { MIC, MIC_OFF, MUTE, VOLUME as VOLUME_KNOB } from "../../../shared/settings/knob-glyphs.ts";
import { type LevelMeter, useLevels } from "../../../sound/index.ts";
import { type SoundState, type SoundStore, useSound } from "../../../sound/store.ts";
import type { Volume } from "../../../system/volume.ts";
import { useColors } from "../../colors.ts";
import { MICROPHONE } from "../../glyphs-machine.ts";
import type { PaneServices } from "../../services.ts";
import { Caption, Group, Note, Page, Slider, Switch } from "../../ui.tsx";
import { Setting } from "../setting.tsx";
import { Failure, ListRow } from "./parts.tsx";
import { AppsCard, RecordingCard } from "./sound-apps.tsx";

const VOLUME = { min: 0, max: 1, step: 0.01 } as const;

/** What a side has to show: its devices, that the system can't say, or that there are none. */
export type DeviceList = "devices" | "unavailable" | "none" | "reading";

export function deviceList(state: Pick<SoundState, "available" | "outputs">): DeviceList {
  if (state.available === false) return "unavailable";
  if (state.available === null) return "reading";
  return state.outputs.length === 0 ? "none" : "devices";
}

/** Whether a microphone's controls belong on the pane: one is there, and its volume can be read. */
export function showsInputControls(state: Pick<SoundState, "available" | "outputs">, volume: Volume | null): boolean {
  return deviceList(state) === "devices" && volume !== null;
}

/** A side's devices, read while the pane is up. */
function useDevices(store: SoundStore): SoundState {
  const state = useSound(store);
  useEffect(() => {
    store.open();
    return () => store.close();
  }, [store]);
  return state;
}

function Devices({ store, state, side, testID }: { store: SoundStore; state: SoundState; side: "output" | "input"; testID: string }) {
  const colors = useColors();
  const list = deviceList(state);
  if (list === "reading") return null;
  return (
    <>
      <Group testID={testID}>
        {list === "unavailable" ? (
          <Note>{side === "output" ? "Sound isn't available on this computer." : "Input devices aren't available on this computer."}</Note>
        ) : list === "none" ? (
          <Note>No output devices found.</Note>
        ) : (
          state.outputs.map((device) => (
            <ListRow
              key={device.id}
              testID={`${side}-device:${device.label}`}
              name={device.label}
              bold={device.current}
              onPress={device.current ? undefined : () => void store.choose(device.id)}
            >
              {device.current && <Svg markup={CHECK} size={14} color={colors.text} />}
            </ListRow>
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
  if (volume === null) return null;
  const shown = volume.muted ? 0 : Math.min(volume.level, 1);
  return (
    <Group testID={`${side}-volume-group`}>
      <Setting
        id={side === "output" ? "sound/output-volume" : "sound/input-volume"}
        glyph={side === "output" ? VOLUME_KNOB : MIC}
        detail={volume.muted ? "Muted" : null}
      >
        <Slider
          testID={`${side}-volume`}
          value={shown}
          range={VOLUME}
          glyph={side === "output" ? speakerGlyph(1, false) : MICROPHONE}
          format={(level) => `${Math.round(level * 100)}%`}
          onCommit={onLevel}
        />
      </Setting>
      <Setting id={side === "output" ? "sound/output-mute" : "sound/input-mute"} glyph={side === "output" ? MUTE : MIC_OFF}>
        <Switch testID={`${side}-mute`} on={volume.muted} onChange={onMute} />
      </Setting>
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

/** The input: its devices, volume, mute and meter while there is a microphone; else one row that says there is none. */
function Input({ services, volume }: { services: PaneServices; volume: Volume | null }) {
  const { inputs, levels, meter } = services;
  const state = useDevices(inputs);
  const list = deviceList(state);
  if (list === "reading") return null;
  if (list === "none") {
    return (
      <Group testID="sound-inputs">
        {/* One plain row in the input volume's place: no slider, no mute, no meter. */}
        <Setting id="sound/input-volume" testID="sound-no-microphone" title="No microphone found" detail="Plug one in, and its volume and mute show up here." />
      </Group>
    );
  }
  return (
    <>
      <Devices store={inputs} state={state} side="input" testID="sound-inputs" />
      {showsInputControls(state, volume) && (
        <>
          <VolumeRow
            side="input"
            volume={volume}
            onLevel={(level) => void levels.setLevel("input", level)}
            onMute={(muted) => void levels.setMuted("input", muted)}
          />
          {volume !== null && !volume.muted && (
            <Group testID="input-level-group">
              <Setting id="sound/input-level">
                <InputMeter meter={meter} />
              </Setting>
            </Group>
          )}
        </>
      )}
    </>
  );
}

export function SoundPane({ services }: { services: PaneServices }) {
  const { levels, sound } = services;
  const volumes = useLevels(levels);
  const outputs = useDevices(sound);
  useEffect(() => {
    levels.open();
    return () => levels.close();
  }, [levels]);
  const current = outputs.outputs.find((output) => output.current);
  return (
    <Page title="Sound" {...(current ? { detail: current.label } : {})}>
      <Caption above>Output</Caption>
      <Devices store={sound} state={outputs} side="output" testID="sound-outputs" />
      <VolumeRow
        side="output"
        volume={volumes.output}
        onLevel={(level) => void levels.setLevel("output", level)}
        onMute={(muted) => void levels.setMuted("output", muted)}
      />
      {services.mixer && <AppsCard mixer={services.mixer} />}
      <Caption above>Input</Caption>
      <Input services={services} volume={volumes.input} />
      {services.mixer && <RecordingCard mixer={services.mixer} />}
      <Caption above>Menu Bar</Caption>
      <Group>
        <Setting id="sound/show-in-menu-bar" control="sound-menubar" />
      </Group>
    </Page>
  );
}
