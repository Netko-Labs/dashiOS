/**
 * Settings › Sound, the full mixer's recording side (docs/design.html,
 * "Settings"): under the Input's cards, a card of the apps that record now,
 * one row each: its icon, its name with the orange dot the menu bar's pill
 * has, the input's live meter, how much of the input it takes (the ink
 * slider) with its mute, and "Record from", a pop-up of Default (which
 * follows the input above) and each microphone. An app that records this
 * computer's own sound (a screen recorder) is listed too, without the dot:
 * what it records is no microphone to choose, so its pop-up says "System sound" and
 * stays as it is. None while nobody records.
 */

import { useColors as usePalette } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { Group } from "../../../shared/cards/index.ts";
import { useControlColors } from "../../../shared/controls/palette.ts";
import { type AppMixer, type AppRecording, type MixerOutput, type StreamMeters, useMixer } from "../../../sound/index.ts";
import { Spot } from "../../spot.tsx";
import { PAGE, useCardRow } from "../row.tsx";
import { Controls, DevicePopUp, Fader, IconKnob, StatusLine } from "./sound-mixer-parts.tsx";

/** What a recorder of a sink's monitor records, short enough for the pop-up: this computer's own sound. */
export const OWN_SOUND = "System sound";

function RecordingRow({
  app,
  mixer,
  meters,
  inputs,
}: {
  app: AppRecording;
  mixer: AppMixer;
  meters: StreamMeters | undefined;
  inputs: readonly MixerOutput[];
}) {
  const colors = useControlColors();
  const { microphone } = usePalette();
  useCardRow(true);
  const from = app.monitor ? OWN_SOUND : app.input;
  return (
    <View
      testID={`sound-recording-row:${app.key}`}
      accessibilityRole="group"
      accessibilityLabel={`${app.name}, recording from ${from}`}
      style={{ minHeight: PAGE.row, flexDirection: "row", flexWrap: "wrap", alignItems: "center", rowGap: 8, columnGap: 12, padding: 8, paddingRight: 16 }}
    >
      <IconKnob icon={app.icon} />
      <View style={{ flex: 1, flexDirection: "column", minWidth: PAGE.words }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <View style={{ flexShrink: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ fontSize: 13.5, fontWeight: "semibold", color: colors.offInk }}>
              {app.name}
            </Text>
          </View>
          {!app.monitor && (
            <View testID={`sound-recording-dot:${app.key}`} style={{ width: 8, height: 8, flexShrink: 0, borderRadius: 4, backgroundColor: microphone }} />
          )}
        </View>
        <StatusLine testID={`sound-recording:${app.key}`} parts={app.parts} playing muted={app.muted} meters={meters} />
      </View>
      <Controls>
        <Fader
          testID={`sound-recording:${app.key}`}
          what={`${app.name} input`}
          level={app.level}
          muted={app.muted}
          onLevel={(level) => void mixer.setRecordingLevel(app.key, level)}
          onMute={(muted) => void mixer.setRecordingMuted(app.key, muted)}
        />
        <DevicePopUp
          testID={`sound-record-from:${app.key}`}
          name={`Record ${app.name} from`}
          target={app.target}
          devices={inputs}
          onChoose={(input) => void mixer.setInput(app.key, input)}
          {...(app.monitor ? { fixed: OWN_SOUND } : {})}
        />
      </Controls>
    </View>
  );
}

/** The apps that record, as a card under the Input's; none while nobody records. */
export function RecordingCard({ mixer, meters }: { mixer: AppMixer; meters?: StreamMeters }) {
  const state = useMixer(mixer);
  if (state.recording.length === 0) return null;
  return (
    <Spot id="sound/using-microphone" cards>
      <Group testID="sound-recording">
        {state.recording.map((app) => (
          <RecordingRow key={app.key} app={app} mixer={mixer} meters={meters} inputs={state.inputs} />
        ))}
      </Group>
    </Spot>
  );
}
