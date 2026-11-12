/**
 * Settings › Sound, the full mixer's playing side (docs/design.html,
 * "Settings"): the Apps card under Output volume, one row per app playing
 * sound, its streams folded under it. The row is the app as a whole: its
 * icon on the 40 knob, its name, a live meter under it ("Paused" when no
 * sound moves), the ink slider 210 wide, a 36 round mute button (ink when
 * muted) and "Play on", a pop-up of Default (which follows the output
 * above) and each output. An app with several streams (a browser's tabs, a
 * game's voice chat and its music) says how many before its meter; a press
 * opens them under it, each with its own meter, slider and mute, and the
 * word turns to "Hide streams". An app with one stream has nothing to open.
 * A folded app is one row. Every app shows here; Control Center shows four.
 * With none: "No apps are playing sound."
 */

import { Text, View } from "@mirinjs/metal";
import { useState } from "react";
import { Caption, Group, Note } from "../../../shared/cards/index.ts";
import { useControlColors } from "../../../shared/controls/palette.ts";
import { type AppMixer, type AppSound, type MixerOutput, type StreamMeters, useMixer } from "../../../sound/index.ts";
import { Spot } from "../../spot.tsx";
import { appSpot } from "../find.ts";
import { PAGE, useCardRow } from "../row.tsx";
import { DevicePopUp, Fader, IconKnob, StatusLine, StreamRow } from "./sound-mixer-parts.tsx";

function AppRow({
  app,
  mixer,
  meters,
  outputs,
  open,
  onFold,
}: {
  app: AppSound;
  mixer: AppMixer;
  meters: StreamMeters | undefined;
  outputs: readonly MixerOutput[];
  open: boolean;
  onFold: () => void;
}) {
  const colors = useControlColors();
  useCardRow(true);
  const folds = app.parts.length > 1;
  const testID = `sound-app-row:${app.key}`;
  return (
    <View
      testID={testID}
      accessibilityRole="group"
      accessibilityLabel={`${app.name}, ${app.playing ? "playing" : "paused"}`}
      style={{ flexDirection: "column" }}
    >
      <View
        style={{ minHeight: PAGE.row, flexDirection: "row", flexWrap: "wrap", alignItems: "center", rowGap: 8, columnGap: 12, padding: 8, paddingRight: 16 }}
      >
        <IconKnob icon={app.icon} />
        <View style={{ flex: 1, flexDirection: "column", minWidth: PAGE.words }}>
          <Text numberOfLines={1} style={{ fontSize: 13.5, fontWeight: "semibold", color: colors.offInk }}>
            {app.name}
          </Text>
          <StatusLine
            testID={`sound-app:${app.key}`}
            parts={app.parts}
            playing={app.playing}
            muted={app.muted}
            meters={meters}
            {...(folds ? { fold: { open, onPress: onFold } } : {})}
          />
        </View>
        <Fader
          testID={`sound-app:${app.key}`}
          what={app.name}
          level={app.level}
          muted={app.muted}
          onLevel={(level) => void mixer.setLevel(app.key, level)}
          onMute={(muted) => void mixer.setMuted(app.key, muted)}
        />
        <DevicePopUp
          testID={`sound-play-on:${app.key}`}
          name={`Play ${app.name} on`}
          target={app.target}
          devices={outputs}
          onChoose={(output) => void mixer.setOutput(app.key, output)}
        />
      </View>
      {open &&
        folds &&
        app.parts.map((part) => (
          <StreamRow
            key={part.id}
            testID={`sound-stream:${part.id}`}
            app={app.name}
            part={part}
            meters={meters}
            onLevel={(level) => void mixer.setStreamLevel(part.id, level)}
            onMute={(muted) => void mixer.setStreamMuted(part.id, muted)}
          />
        ))}
    </View>
  );
}

/** The Apps card: each app's volume, its streams', and where it plays. */
export function AppsCard({ mixer, meters }: { mixer: AppMixer; meters?: StreamMeters }) {
  const state = useMixer(mixer);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  if (!state.available) return null;
  const fold = (key: string) =>
    setOpen((now) => {
      const next = new Set(now);
      if (!next.delete(key)) next.add(key);
      return next;
    });
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
              <AppRow app={app} mixer={mixer} meters={meters} outputs={state.outputs} open={open.has(app.key)} onFold={() => fold(app.key)} />
            </Spot>
          ))
        )}
      </Group>
    </Spot>
  );
}
