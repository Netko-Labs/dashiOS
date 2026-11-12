/**
 * The pieces Settings › Sound's mixer rows are made of (sound-apps.tsx, the
 * apps that play; sound-recording.tsx, the apps that record): the app's
 * icon on the row's knob, the live meter, the slider with its mute button,
 * the pop-up that chooses a device, and a stream's row under its app.
 * Every control is named for a screen reader by what it changes ("Helium
 * volume", "Mute Helium", "Play Helium on").
 */

import { MoreButton, PopUpButton, type PopUpOption } from "@dashi/ui";
import { Image, Text, View } from "@mirinjs/metal";
import { type ReactNode, useState } from "react";
import { InkSlider } from "../../../shared/controls/ink-slider.tsx";
import { useControlColors } from "../../../shared/controls/palette.ts";
import { type MixerOutput, MuteKnob, type StreamMeters, type StreamSound, useMeterLevel } from "../../../sound/index.ts";
import { PAGE } from "../row.tsx";

/**
 * The rows' measures: the slider 210 wide, the mute button 36, the device's
 * pop-up 144 wide (so the sliders line up), the icon 24 on the knob; the
 * line under the name 20 tall, the meter on it 64 by 4; a stream's row 44,
 * its words starting where its app's do. In a narrow window a stream's
 * controls go under its title: they then sit `tied` under it, and the title
 * starts `apart` below the controls above, so each slider reads as its
 * title's.
 */
export const APPS_CARD = {
  slider: 210,
  mute: 36,
  popUp: 144,
  icon: 24,
  line: 20,
  meter: { width: 64, height: 4 },
  stream: 44,
  tied: 0,
  apart: 14,
} as const;

/** Whether a stream's controls wrapped under its title: the row is then taller than its one line and a half of the controls' height. */
export function streamWrapped(height: number): boolean {
  return height > APPS_CARD.stream + APPS_CARD.mute / 2;
}

/**
 * A stream row's spacing. On one line: nothing above, 6 between and under.
 * Wrapped: `apart` above the title and `tied` between it and its controls,
 * so the space under a slider is more than twice the space over it.
 */
export function streamSpacing(wrapped: boolean): { paddingTop: number; rowGap: number; paddingBottom: number } {
  return wrapped ? { paddingTop: APPS_CARD.apart, rowGap: APPS_CARD.tied, paddingBottom: 6 } : { paddingTop: 0, rowGap: 6, paddingBottom: 6 };
}

const VOLUME = { min: 0, max: 1, step: 0.01 } as const;

/** The app's icon on the row's 40 knob. */
export function IconKnob({ icon }: { icon: string }) {
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

/** A level as a bar: ink on the line colour, never green (it is a reading, not a switch that is on). */
export function MeterBar({
  level,
  testID,
  width = APPS_CARD.meter.width,
  height = APPS_CARD.meter.height,
}: {
  level: number;
  testID: string;
  width?: number;
  height?: number;
}) {
  const colors = useControlColors();
  const shown = Math.min(Math.max(level, 0), 1);
  return (
    <View
      testID={testID}
      // A picture to a screen reader: a level read out ten times a second would drown everything else.
      accessibilityRole="image"
      accessibilityLabel="Level meter"
      style={{ width, height, flexShrink: 0, borderRadius: height / 2, overflow: "hidden", backgroundColor: colors.line }}
    >
      <View testID={`${testID}-fill`} style={{ width: Math.round(width * shown), height, borderRadius: height / 2, backgroundColor: colors.fill }} />
    </View>
  );
}

/** The meter of the nodes `serials` name (the loudest); it listens only while it is on screen and names one. A muted row reads empty. */
export function LiveMeter({
  meters,
  serials,
  muted,
  testID,
}: {
  meters: StreamMeters | undefined;
  serials: readonly number[];
  muted: boolean;
  testID: string;
}) {
  const level = useMeterLevel(meters, muted ? [] : serials);
  return <MeterBar testID={testID} level={level} />;
}

/** The nodes a row's meter listens to: each part that plays (or records) now. */
export const meterNodes = (parts: readonly StreamSound[]): number[] => [
  ...new Set(parts.flatMap((part) => (part.playing && part.meter !== null ? [part.meter] : []))),
];

/** The line under a row's name: the fold (an app with several streams), then the meter while sound moves, else "Paused". An open app shows no meter of its own: each stream's says it. */
export function StatusLine({
  testID,
  parts,
  playing,
  muted,
  meters,
  fold,
}: {
  testID: string;
  parts: readonly StreamSound[];
  playing: boolean;
  muted: boolean;
  meters: StreamMeters | undefined;
  fold?: { open: boolean; onPress: () => void };
}) {
  const colors = useControlColors();
  const open = fold?.open === true;
  return (
    <View style={{ height: APPS_CARD.line, flexDirection: "row", alignItems: "center", gap: 8 }}>
      {fold && <MoreButton testID={`${testID}:fold`} open={fold.open} onPress={fold.onPress} more={`${parts.length} streams`} less="Hide streams" />}
      {!playing && <Text style={{ fontSize: 11.5, color: colors.muted }}>Paused</Text>}
      {playing && !open && <LiveMeter testID={`${testID}:meter`} meters={meters} serials={meterNodes(parts)} muted={muted} />}
    </View>
  );
}

/** A row's controls, kept together: in a narrow window they go under the words as one line, never one of them alone. */
export function Controls({ children }: { children: ReactNode }) {
  return <View style={{ flexShrink: 0, flexDirection: "row", alignItems: "center", gap: 12 }}>{children}</View>;
}

/** A level's slider and its mute button, named for `what` ("Helium", "Helium, Playback 2"). */
export function Fader({
  testID,
  what,
  level,
  muted,
  onLevel,
  onMute,
}: {
  testID: string;
  what: string;
  level: number;
  muted: boolean;
  onLevel: (level: number) => void;
  onMute: (muted: boolean) => void;
}) {
  const colors = useControlColors();
  return (
    <View style={{ flexShrink: 0, flexDirection: "row", alignItems: "center", gap: 8 }}>
      <View accessibilityRole="group" accessibilityLabel={`${what} volume`}>
        <InkSlider
          testID={`${testID}-volume`}
          value={muted ? 0 : Math.min(level, 1)}
          range={VOLUME}
          width={APPS_CARD.slider}
          format={(value) => (muted ? "Muted" : `${Math.round(value * 100)}%`)}
          onChange={onLevel}
        />
      </View>
      <MuteKnob
        testID={`${testID}-mute`}
        focusable
        label={`Mute ${what}`}
        muted={muted}
        size={APPS_CARD.mute}
        ground={colors.knobRest}
        onPress={() => onMute(!muted)}
      />
    </View>
  );
}

const DEFAULT = "";
/** A value no option has (a node.name is never empty, nor starts with a space). */
const NO_OPTION = " ";

/**
 * The device an app plays on or records from: Dashi's pop-up button,
 * "Default" (it follows the device chosen above) over each device, the one
 * chosen ticked. A choice that is none of them reads as itself: a device
 * that is gone by its name, this computer's own sound as `fixed` ("System sound"), which
 * can't be changed here.
 */
export function DevicePopUp({
  testID,
  name,
  target,
  devices,
  onChoose,
  fixed,
}: {
  testID: string;
  /** What a screen reader calls it: "Play Helium on". */
  name: string;
  /** The chosen device's node.name, or null for the default. */
  target: string | null;
  devices: readonly MixerOutput[];
  onChoose: (device: string | null) => void;
  /** What it records that is no device to choose ("System sound"): shown, and not changed. */
  fixed?: string;
}) {
  const gone = target !== null && !devices.some((device) => device.name === target);
  const placeholder = fixed ?? (gone ? target : undefined);
  const options: PopUpOption<string>[] = [
    { value: DEFAULT, label: "Default" },
    ...(devices.length > 0 ? [{ type: "separator" as const }] : []),
    ...devices.map((device) => ({ value: device.name, label: device.label })),
  ];
  return (
    <View accessibilityRole="group" accessibilityLabel={name} style={{ flexShrink: 0 }}>
      <PopUpButton
        testID={testID}
        options={options}
        value={placeholder !== undefined ? NO_OPTION : (target ?? DEFAULT)}
        onChange={(value) => onChoose(value === DEFAULT ? null : value)}
        width={APPS_CARD.popUp}
        {...(placeholder !== undefined ? { placeholder } : {})}
        {...(fixed !== undefined ? { disabled: true } : {})}
      />
    </View>
  );
}

/** One stream under its app: its title where the app's name starts, its meter, and its own slider and mute, in line with the app's. */
export function StreamRow({
  testID,
  app,
  part,
  meters,
  onLevel,
  onMute,
}: {
  testID: string;
  app: string;
  part: StreamSound;
  meters: StreamMeters | undefined;
  onLevel: (level: number) => void;
  onMute: (muted: boolean) => void;
}) {
  const colors = useControlColors();
  // The row's own height says whether its controls wrapped; the spacing it then takes keeps it over the line either way.
  const [wrapped, setWrapped] = useState(false);
  return (
    <View
      testID={testID}
      accessibilityRole="group"
      accessibilityLabel={`${app}, ${part.title}`}
      onLayout={(laid) => setWrapped(streamWrapped(laid.height))}
      style={{
        minHeight: APPS_CARD.stream,
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "center",
        columnGap: 12,
        paddingLeft: PAGE.knobInset,
        paddingRight: PAGE.inset,
        ...streamSpacing(wrapped),
      }}
    >
      {/* The knob's room, so the title starts where the app's name does and wrapped controls sit under the app's. */}
      <View style={{ width: PAGE.knob, height: 1, flexShrink: 0 }} />
      <View style={{ flex: 1, flexDirection: "column", minWidth: PAGE.words }}>
        <Text numberOfLines={1} style={{ fontSize: 12.5, color: colors.offInk }}>
          {part.title}
        </Text>
        <StatusLine testID={testID} parts={[part]} playing={part.playing} muted={part.muted} meters={meters} />
      </View>
      <Controls>
        <Fader testID={testID} what={`${app}, ${part.title}`} level={part.level} muted={part.muted} onLevel={onLevel} onMute={onMute} />
        {/* The room the app's pop-up takes, so a stream's slider sits under its app's. */}
        <View style={{ width: APPS_CARD.popUp, height: 1, flexShrink: 0 }} />
      </Controls>
    </View>
  );
}
