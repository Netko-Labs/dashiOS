/**
 * Settings › Sound, the apps (docs/design.html, "Settings"): the Apps card
 * under Output volume, one row per app playing sound (its icon on the 40
 * knob, its name and "Playing" or "Paused", the ink slider 210 wide, a 36
 * round mute button, ink when muted, and "Play on": Default, which follows
 * the output above, or the output it was sent to). Every app shows here;
 * Control Center shows four. With none: "No apps are playing sound." The
 * apps using the microphone join the Input card, read only.
 */

import { PopupMenu, useColors as usePalette, useWindowLayer } from "@dashi/ui";
import { type Bounds, createPortal, Image, Text, View } from "@mirinjs/metal";
import { useRef, useState } from "react";
import { Caption, Group, Note } from "../../../shared/cards/index.ts";
import { InkSlider } from "../../../shared/controls/ink-slider.tsx";
import { useControlColors } from "../../../shared/controls/palette.ts";
import { type AppMixer, type AppRecording, type AppSound, type MixerOutput, MuteKnob, playOnLabel, useMixer } from "../../../sound/index.ts";
import { Spot } from "../../spot.tsx";
import { appSpot } from "../find.ts";
import { PAGE, useCardRow } from "../row.tsx";

/** The row's measures: the slider 210 wide, the mute button 36, "Play on" a pill 28 tall and 128 wide, so the sliders line up. */
export const APPS_CARD = { slider: 210, mute: 36, pill: 28, pillWidth: 128, icon: 24 } as const;

const VOLUME = { min: 0, max: 1, step: 0.01 } as const;

/** The app's icon on the row's 40 knob. */
function IconKnob({ icon }: { icon: string }) {
  const colors = useControlColors();
  return (
    <View
      style={{
        width: PAGE.knob,
        height: PAGE.knob,
        flexShrink: 0,
        borderRadius: PAGE.knob / 2,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: colors.knobRest,
      }}
    >
      <Image source={icon} style={{ width: APPS_CARD.icon, height: APPS_CARD.icon }} />
    </View>
  );
}

/** "Play on": a pill with the output's name, opening Default and each output in Dashi's menu, the one in use ticked. */
function PlayOn({ app, outputs, onChoose }: { app: AppSound; outputs: readonly MixerOutput[]; onChoose: (output: string | null) => void }) {
  const colors = useControlColors();
  const layer = useWindowLayer();
  const [open, setOpen] = useState<Bounds | null>(null);
  const laid = useRef<Bounds | null>(null);
  const items = [
    { label: "Default", checked: app.target === null, onPress: () => app.target !== null && onChoose(null) },
    ...outputs.map((output) => ({
      label: output.label,
      checked: app.target === output.name,
      onPress: () => app.target !== output.name && onChoose(output.name),
    })),
  ];
  const menu =
    open === null ? null : (
      <PopupMenu
        testID={`sound-play-on:${app.key}:menu`}
        x={Math.round(open.x)}
        y={Math.round(open.y + open.height + 4)}
        items={items}
        onClose={() => setOpen(null)}
      />
    );
  return (
    <View
      testID={`sound-play-on:${app.key}`}
      focusable
      accessibilityRole="button"
      accessibilityLabel={`Play on ${playOnLabel(app.target, outputs)}`}
      onPress={(event) => setOpen(event.bounds ?? laid.current)}
      onLayout={(bounds) => {
        laid.current = bounds;
      }}
      style={{
        height: APPS_CARD.pill,
        width: APPS_CARD.pillWidth,
        flexShrink: 0,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 4,
        paddingLeft: 12,
        paddingRight: 10,
        borderRadius: APPS_CARD.pill / 2,
        borderWidth: 1.5,
        borderColor: colors.line,
        hoverBackgroundColor: colors.knobOff,
        focusRingColor: colors.focus,
      }}
    >
      <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: "semibold", color: colors.text }}>
        {playOnLabel(app.target, outputs)}
      </Text>
      <Text style={{ fontSize: 10, color: colors.muted }}>▾</Text>
      {menu && (layer === null ? menu : createPortal(menu, layer))}
    </View>
  );
}

function AppRow({ app, mixer, outputs }: { app: AppSound; mixer: AppMixer; outputs: readonly MixerOutput[] }) {
  const colors = useControlColors();
  useCardRow(true);
  return (
    <View
      testID={`sound-app-row:${app.key}`}
      style={{ minHeight: PAGE.row, flexDirection: "row", flexWrap: "wrap", alignItems: "center", rowGap: 8, columnGap: 12, padding: 8, paddingRight: 16 }}
    >
      <IconKnob icon={app.icon} />
      <View style={{ flex: 1, flexDirection: "column", gap: 1, minWidth: PAGE.words }}>
        <Text numberOfLines={1} style={{ fontSize: 13.5, fontWeight: "semibold", color: colors.offInk }}>
          {app.name}
        </Text>
        <Text style={{ fontSize: 11.5, color: colors.muted }}>{app.playing ? "Playing" : "Paused"}</Text>
      </View>
      <View style={{ flexShrink: 0, flexDirection: "row", alignItems: "center", gap: 8 }}>
        <InkSlider
          testID={`sound-app-volume:${app.key}`}
          value={app.muted ? 0 : Math.min(app.level, 1)}
          range={VOLUME}
          width={APPS_CARD.slider}
          format={(level) => (app.muted ? "Muted" : `${Math.round(level * 100)}%`)}
          onChange={(level) => void mixer.setLevel(app.key, level)}
        />
        <MuteKnob
          testID={`sound-app-mute:${app.key}`}
          muted={app.muted}
          size={APPS_CARD.mute}
          ground={colors.knobRest}
          onPress={() => void mixer.setMuted(app.key, !app.muted)}
        />
        <PlayOn app={app} outputs={outputs} onChoose={(output) => void mixer.setOutput(app.key, output)} />
      </View>
    </View>
  );
}

/** The Apps card: each app's volume, and where it plays. */
export function AppsCard({ mixer }: { mixer: AppMixer }) {
  const state = useMixer(mixer);
  if (!state.available) return null;
  return (
    <Spot id="sound/apps" cards>
      <Caption above>Apps</Caption>
      <Group testID="sound-apps">
        {state.apps.length === 0 ? (
          <Note testID="sound-apps-none">No apps are playing sound.</Note>
        ) : (
          state.apps.map((app) => (
            // Each row has its own Spot: Settings' search finds the app by its name (find.ts).
            <Spot key={app.key} id={appSpot(app.key)}>
              <AppRow app={app} mixer={mixer} outputs={state.outputs} />
            </Spot>
          ))
        )}
      </Group>
    </Spot>
  );
}

/** One app using the microphone: its icon, its name, "Using Microphone now", and the orange dot with "Recording". */
function RecordingRow({ app }: { app: AppRecording }) {
  const colors = useControlColors();
  const { microphone } = usePalette();
  useCardRow(true);
  return (
    <View
      testID={`sound-recording-row:${app.key}`}
      style={{ minHeight: PAGE.row, flexDirection: "row", alignItems: "center", gap: 12, padding: 8, paddingRight: 16 }}
    >
      <IconKnob icon={app.icon} />
      <View style={{ flex: 1, flexDirection: "column", gap: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 13.5, fontWeight: "semibold", color: colors.offInk }}>
          {app.name}
        </Text>
        <Text numberOfLines={1} style={{ fontSize: 11.5, color: colors.muted }}>{`Using ${app.input} now`}</Text>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: microphone }} />
        <Text style={{ fontSize: 12, fontWeight: "semibold", color: colors.offInk }}>Recording</Text>
      </View>
    </View>
  );
}

/** The apps using the microphone, as a card under the Input's; none while nobody records. */
export function RecordingCard({ mixer }: { mixer: AppMixer }) {
  const recording = useMixer(mixer).recording.filter((each) => !each.monitor);
  if (recording.length === 0) return null;
  return (
    <Spot id="sound/using-microphone" cards>
      <Group testID="sound-recording">
        {recording.map((app) => (
          <RecordingRow key={app.key} app={app} />
        ))}
      </Group>
    </Spot>
  );
}
