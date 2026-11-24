/**
 * Control Center's Sound page, its apps (docs/design.html, "Control
 * Center"): under the outputs, each app playing sound as a flat ink slider
 * as tall as a page row (48), its icon on the chip and its name on a chip,
 * its level at the right, and a 48 mute knob beside it. Muted is ink, not
 * green (CC-1), and the fill goes. Up to four apps; past that, three and a
 * row "N more in Sound Settings…". This is the short list: an app's
 * streams, its output, its meter and what it records with are the full
 * mixer's, in Settings › Sound, which the page's last row opens. Then the
 * apps using the microphone, read only, each with the orange dot the menu
 * bar's pill has. With no app playing or recording, neither section is
 * there. By the keyboard an app's row is one stop: ← and → move its level
 * a twentieth, Space or Return mutes it.
 */

import { KnobButton, pill, SliderTile, SPACE, useColors, useControlColors } from "@dashi/ui";
import { View } from "@mirinjs/metal";
import { percentText } from "../control-center/catalog.ts";
import { GRID } from "../control-center/layout.ts";
import { PageRow, PageSection } from "../control-center/page-parts.tsx";
import { usePageKey } from "../control-center/page-stops.ts";
import { speakerGlyph } from "../glyphs.ts";
import { AppIcon } from "../shared/apps/index.ts";
import type { AppRecording, AppSound } from "./apps/index.ts";

/** A row 48 tall; the mute knob 48 across, 6 from the slider. */
export const APP_ROW = { height: 48, knob: 48, gap: SPACE.s, chip: 36, icon: 22, glyph: 16, shown: 4, mark: 8 } as const;

const SLIDER_WIDTH = GRID.width - 2 * GRID.padding - APP_ROW.knob - APP_ROW.gap;

/** The rows that show: all of up to `max`, else `max - 1` and how many more. */
export function foldApps<T>(apps: readonly T[], max: number = APP_ROW.shown): { shown: T[]; more: number } {
  if (apps.length <= max) return { shown: [...apps], more: 0 };
  return { shown: apps.slice(0, max - 1), more: apps.length - (max - 1) };
}

/** What a row's level reads: "Muted", or the percent. */
export const appLevelText = (app: Pick<AppSound, "level" | "muted">): string => (app.muted ? "Muted" : percentText(app.level));

/** An app's level: the kit's flat slider tile, the app's icon on its chip. */
function AppLevel({ app, onLevel }: { app: AppSound; onLevel: (level: number) => void }) {
  const colors = useControlColors();
  const icon = (
    <View
      style={{
        width: APP_ROW.chip,
        height: APP_ROW.chip,
        borderRadius: pill(APP_ROW.chip),
        flexShrink: 0,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: colors.chip,
      }}
    >
      <AppIcon source={app.icon} style={{ width: APP_ROW.icon, height: APP_ROW.icon }} />
    </View>
  );
  return (
    <View style={{ width: SLIDER_WIDTH, height: APP_ROW.height, flexDirection: "row" }}>
      <SliderTile
        look={{
          testID: `sound-app:${app.key}`,
          title: app.name,
          glyph: "",
          level: app.muted ? 0 : Math.min(app.level, 1),
          value: appLevelText(app),
          width: SLIDER_WIDTH,
          height: APP_ROW.height,
        }}
        standing={false}
        onLevel={onLevel}
        lead={icon}
      />
    </View>
  );
}

/**
 * The mute knob: the speaker on `ground` (the row's color unless said);
 * muted, the crossed speaker on ink (the kit's KnobButton, a switch).
 */
export function Mute({
  testID,
  muted,
  size,
  ground,
  label = "Mute",
  focusable = false,
  onPress,
}: {
  testID: string;
  muted: boolean;
  size: number;
  ground?: string;
  /** What a screen reader calls it: "Mute Helium". */
  label?: string;
  /** Tab reaches it (a window's; Control Center's page has its own keys). */
  focusable?: boolean;
  onPress: () => void;
}) {
  const colors = useControlColors();
  return (
    <KnobButton
      testID={testID}
      glyph={speakerGlyph(muted ? 0 : 1, muted)}
      label={label}
      checked={muted}
      size={size}
      glyphSize={APP_ROW.glyph}
      ground={ground ?? colors.off}
      focusable={focusable}
      onPress={onPress}
    />
  );
}

/** A step of the arrows: a twentieth. */
export const APP_STEP = 0.05;

/** The level one arrow from `level`: the next twentieth that way, within 0 to 1. */
export function steppedLevel(level: number, direction: "left" | "right"): number {
  const from = Number.isFinite(level) ? Math.min(Math.max(level, 0), 1) : 0;
  const twentieths = Math.round(from / APP_STEP) + (direction === "right" ? 1 : -1);
  return Math.min(Math.max(twentieths * APP_STEP, 0), 1);
}

/** One app: its slider and its mute knob, one stop of the page's keys. */
function AppRow({ app, onLevel, onMute }: { app: AppSound; onLevel: (level: number) => void; onMute: (muted: boolean) => void }) {
  const colors = useControlColors();
  const key = usePageKey(
    `sound-app-row:${app.key}`,
    () => onMute(!app.muted),
    (direction) => onLevel(steppedLevel(app.muted ? 0 : app.level, direction)),
  );
  return (
    <View
      testID={`sound-app-row:${app.key}`}
      onLayout={key.onLayout}
      focusRingShown={key.focused}
      style={{
        height: APP_ROW.height,
        flexDirection: "row",
        alignItems: "center",
        gap: APP_ROW.gap,
        position: "relative",
        borderRadius: pill(APP_ROW.height),
        focusRingColor: colors.focus,
      }}
    >
      <AppLevel app={app} onLevel={onLevel} />
      <Mute testID={`sound-app-mute:${app.key}`} label={`Mute ${app.name}`} muted={app.muted} size={APP_ROW.knob} onPress={() => onMute(!app.muted)} />
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
        <AppRow key={app.key} app={app} onLevel={(level) => onLevel(app.key, level)} onMute={(muted) => onMute(app.key, muted)} />
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
          trailing={<View style={{ width: APP_ROW.mark, height: APP_ROW.mark, borderRadius: pill(APP_ROW.mark), backgroundColor: microphone }} />}
        />
      ))}
    </>
  );
}
