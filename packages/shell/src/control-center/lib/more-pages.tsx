/**
 * Control Center's Display and Focus pages (design.html CC-5, CC-6; decisions.md D765, D785), grown out
 * of their tiles as every page is (page-parts.tsx). Display: the screen's brightness as the flat slider,
 * Night Shift and Dark as rows with switches, Displays Settings…. Focus: for how long, each choice saying
 * until when, the one in effect on; what Focus holds back; Notifications Settings….
 */

import { SliderTile, Switch } from "@dashi/ui";
import { SUN } from "../../glyphs.ts";
import { useFlags } from "../../shared/control-center/index.ts";
import { glyph } from "../../shared/inks/index.ts";
import { useClockPrefs } from "../../shared/time/index.ts";
import { type ControlSnapshot, percentText } from "../catalog.ts";
import { chooseFocus, type FocusChoice, focusChoices, focusChosen, focusDetail, untilWords } from "../focus.ts";
import { CONTRAST, MOON, SUNSET } from "../glyphs.ts";
import { GRID } from "../layout.ts";
import { PAGE_ROW, PageBody, PageFoot, PageHeader, PageNote, PageRow } from "../page-parts.tsx";
import type { ControlCenterProps } from "../panel.tsx";

/** The page's inner width: the panel less its padding. */
const INNER = GRID.width - 2 * GRID.padding;

/** What Focus holds back, in one line (CC-6). */
export const FOCUS_NOTE = "Banners wait in the area. Agents’ questions still ask.";

/** The screen Dashi can dim: the built-in one (the backlight's). */
const BUILT_IN = "Built-in";

export function DisplayPage({ props, snapshot, onBack }: { props: ControlCenterProps; snapshot: ControlSnapshot; onBack: () => void }) {
  const { devices, flags } = props;
  const level = snapshot.brightness;
  return (
    <>
      <PageHeader testID="display-header" title="Display" detail={level === null ? null : `${BUILT_IN} · ${percentText(level)}`} on={false} onBack={onBack} />
      <PageBody>
        {level !== null && (
          <SliderTile
            look={{ testID: "display-brightness", title: "Brightness", glyph: SUN, level, value: percentText(level), width: INNER, height: PAGE_ROW.height }}
            standing={false}
            onLevel={(next) => devices.setBrightnessLevel(next)}
          />
        )}
        <PageRow
          testID="display-night"
          label="Night Shift"
          subtitle="Sunset to sunrise"
          glyph={SUNSET}
          onPress={() => flags.toggle("night")}
          control={<Switch testID="display-night-switch" look="panel" label="Night Shift" on={snapshot.night} focusable={false} onChange={() => flags.toggle("night")} />}
        />
        <PageRow
          testID="display-dark"
          label="Dark"
          subtitle="Follows the time of day"
          glyph={CONTRAST}
          onPress={() => flags.toggle("dark")}
          control={<Switch testID="display-dark-switch" look="panel" label="Dark" on={snapshot.dark} focusable={false} onChange={() => flags.toggle("dark")} />}
        />
        {props.onSettings && <PageFoot testID="display-settings" label="Displays Settings…" onPress={() => props.onSettings?.("displays")} />}
      </PageBody>
    </>
  );
}

/** Each choice's glyph: a timer, the sun going down, the moon, Focus's own moon. */
const FOCUS_GLYPH: Record<FocusChoice["id"], string> = { hour: glyph("timer"), evening: glyph("sun"), tomorrow: glyph("moon"), off: MOON };

export function FocusPage({ props, onBack, now = new Date() }: { props: ControlCenterProps; onBack: () => void; now?: Date }) {
  const { flags } = props;
  const state = useFlags(flags);
  const prefs = useClockPrefs();
  const chosen = focusChosen(state);
  return (
    <>
      <PageHeader
        testID="focus-header"
        title="Focus"
        detail={focusDetail(state, prefs)}
        on={state.dnd}
        onBack={onBack}
        toggle={{ on: state.dnd, onChange: () => flags.toggle("dnd") }}
      />
      <PageBody>
        {focusChoices(now).map((choice) => (
          <PageRow
            key={choice.id}
            testID={`focus-${choice.id}`}
            label={choice.label}
            subtitle={choice.until === null ? null : untilWords(choice.until, prefs)}
            glyph={FOCUS_GLYPH[choice.id]}
            checked={chosen === choice.id}
            onPress={() => chooseFocus(flags, choice.id, new Date())}
          />
        ))}
        <PageNote testID="focus-note">{FOCUS_NOTE}</PageNote>
        {props.onSettings && <PageFoot testID="focus-settings" label="Notifications Settings…" onPress={() => props.onSettings?.("notifications")} />}
      </PageBody>
    </>
  );
}
