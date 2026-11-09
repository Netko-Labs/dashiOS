/**
 * Control Center's Sound page, its apps (docs/design.html, "Control
 * Center"): under the outputs, each app playing sound as a flat ink slider
 * as tall as a page row (48), its icon on the chip and its name on a chip,
 * its level at the right, and a 48 mute knob beside it. Muted is ink, not
 * green (CC-1), and the fill goes. Up to four apps; past that, three and a
 * row "N more in Sound Settings…". Then the apps using the microphone,
 * read only, each with the orange dot the menu bar's pill has. With no app
 * playing or recording, neither section is there (CC-2).
 */

import { useColors } from "@dashi/ui";
import { Image, Svg, Text, View } from "@mirinjs/metal";
import { percentText } from "../control-center/catalog.ts";
import { GRID } from "../control-center/layout.ts";
import { PageRow, PageSection } from "../control-center/page-parts.tsx";
import { speakerGlyph } from "../glyphs.ts";
import { useControlColors } from "../shared/controls/palette.ts";
import { InkFill } from "../shared/controls/parts.tsx";
import { fillLength, levelAt } from "../shared/controls/slider-math.ts";
import type { AppRecording, AppSound } from "./apps/index.ts";

/** A row 48 tall; the mute knob 48 across, 6 from the slider. */
export const APP_ROW = { height: 48, knob: 48, gap: 6, chip: 36, icon: 22, shown: 4 } as const;

const SLIDER_WIDTH = GRID.width - 2 * GRID.padding - APP_ROW.knob - APP_ROW.gap;

/** The rows that show: all of up to `max`, else `max - 1` and how many more. */
export function foldApps<T>(apps: readonly T[], max: number = APP_ROW.shown): { shown: T[]; more: number } {
  if (apps.length <= max) return { shown: [...apps], more: 0 };
  return { shown: apps.slice(0, max - 1), more: apps.length - (max - 1) };
}

/** What a row's level reads: "Muted", or the percent. */
export const appLevelText = (app: Pick<AppSound, "level" | "muted">): string => (app.muted ? "Muted" : percentText(app.level));

function AppSlider({ app, onLevel }: { app: AppSound; onLevel: (level: number) => void }) {
  const colors = useControlColors();
  const level = app.muted ? 0 : Math.min(app.level, 1);
  const fill = fillLength(level, SLIDER_WIDTH);
  const radius = APP_ROW.height / 2;
  const onInk = fill > SLIDER_WIDTH - 48;
  return (
    <View
      testID={`sound-app:${app.key}`}
      onPointer={(event) => event.bounds && onLevel(levelAt(event.bounds, event.x, event.y, false))}
      accessibilityRole="group"
      accessibilityLabel={`${app.name}, ${appLevelText(app)}`}
      style={{ width: SLIDER_WIDTH, height: APP_ROW.height, position: "relative", borderRadius: radius, backgroundColor: colors.off, overflow: "hidden" }}
    >
      <InkFill length={fill} total={SLIDER_WIDTH} standing={false} radius={radius} />
      <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 6, paddingRight: 14 }}>
        <View
          style={{
            width: APP_ROW.chip,
            height: APP_ROW.chip,
            borderRadius: APP_ROW.chip / 2,
            flexShrink: 0,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: colors.chip,
          }}
        >
          <Image source={app.icon} style={{ width: APP_ROW.icon, height: APP_ROW.icon }} />
        </View>
        <View
          style={{
            flexShrink: 1,
            minWidth: 0,
            paddingLeft: 8,
            paddingRight: 8,
            paddingTop: 2,
            paddingBottom: 2,
            borderRadius: 10,
            backgroundColor: colors.chip,
          }}
        >
          <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: "semibold", color: colors.text }}>
            {app.name}
          </Text>
        </View>
        <View style={{ marginLeft: "auto", flexShrink: 0 }}>
          <Text style={{ fontSize: 11, fontWeight: "semibold", color: onInk ? colors.fillInk : colors.muted }}>{appLevelText(app)}</Text>
        </View>
      </View>
    </View>
  );
}

/** The mute knob: the speaker on the row's color; muted, the crossed speaker on ink. */
export function MuteKnob({ testID, muted, size, onPress }: { testID: string; muted: boolean; size: number; onPress: () => void }) {
  const colors = useControlColors();
  return (
    <View
      testID={testID}
      onPress={onPress}
      accessibilityRole="switch"
      accessibilityLabel="Mute"
      accessibilityState={{ checked: muted }}
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: size / 2,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: muted ? colors.fill : colors.off,
        focusRingColor: colors.focus,
      }}
    >
      <Svg markup={speakerGlyph(muted ? 0 : 1, muted)} size={16} color={muted ? colors.fillInk : colors.offInk} />
    </View>
  );
}

export interface AppSectionsProps {
  apps: readonly AppSound[];
  recording: readonly AppRecording[];
  onLevel: (key: string, level: number) => void;
  onMute: (key: string, muted: boolean) => void;
  /** Sound Settings, for the apps that didn't fit. */
  onMore?: () => void;
}

/** The Apps and Using the microphone sections; nothing when no app plays or records. */
export function AppSections({ apps, recording, onLevel, onMute, onMore }: AppSectionsProps) {
  const { microphone } = useColors();
  const { shown, more } = foldApps(apps);
  const mic = recording.filter((each) => !each.monitor);
  return (
    <>
      {shown.length > 0 && <PageSection>Apps</PageSection>}
      {shown.map((app) => (
        <View key={app.key} style={{ height: APP_ROW.height, flexDirection: "row", alignItems: "center", gap: APP_ROW.gap }}>
          <AppSlider app={app} onLevel={(level) => onLevel(app.key, level)} />
          <MuteKnob testID={`sound-app-mute:${app.key}`} muted={app.muted} size={APP_ROW.knob} onPress={() => onMute(app.key, !app.muted)} />
        </View>
      ))}
      {more > 0 && <PageRow testID="sound-apps-more" label={`${more} more in Sound Settings…`} {...(onMore ? { onPress: onMore } : {})} />}
      {mic.length > 0 && <PageSection>Using the microphone</PageSection>}
      {mic.map((each) => (
        <PageRow
          key={each.key}
          testID={`sound-recording:${each.key}`}
          label={each.name}
          icon={each.icon}
          detail={each.input}
          trailing={<View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: microphone }} />}
        />
      ))}
    </>
  );
}
