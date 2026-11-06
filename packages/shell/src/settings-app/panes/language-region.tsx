/**
 * Language & Region: the system language (through localed, with your
 * password when it must), the region whose formats dates, times, and
 * numbers follow, and the first day of the week. The language is the
 * computer's; the region and the first day are this person's (settings.json
 * `region`).
 */

import { useColors } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { useClockPrefs, useMinuteClock } from "../../clock.ts";
import { LocalePickers } from "../../region/pickers.tsx";
import { describeFailure, type RegionStore, useRegion } from "../../region/store.ts";
import { firstDayIndex, previewFormats, weekdayNames } from "../../region/week.ts";
import { useSettings } from "../hooks.ts";
import type { SettingsStore } from "../store.ts";
import { Caption, Choices, Group, Page, Row, Spot } from "../ui.tsx";

const WEEK_OPTIONS = [
  { value: "auto", label: "Region default" },
  { value: "sunday", label: "Sunday" },
  { value: "monday", label: "Monday" },
  { value: "saturday", label: "Saturday" },
] as const;

export function LanguageRegionPane({ region, settings }: { region: RegionStore; settings: SettingsStore }) {
  const colors = useColors();
  const state = useRegion(region);
  const prefs = useClockPrefs();
  const now = useMinuteClock();
  const { region: chosen } = useSettings(settings).data;
  const language = state.locales.find((entry) => entry.id === state.language);
  const formatsLabel = chosen.formats ? (state.locales.find((entry) => entry.id === chosen.formats)?.region ?? chosen.formats) : "same as language";
  const preview = previewFormats(prefs, now);
  const days = weekdayNames(prefs.locale, firstDayIndex(prefs.locale, chosen.firstWeekday));
  return (
    <Page title="Language & Region">
      <Group>
        <Row stack label="Language and region" detail={`Language: ${language?.label ?? state.language ?? "not set"} · Formats: ${formatsLabel}`}>
          <LocalePickers
            locales={state.locales}
            language={state.language}
            formats={chosen.formats}
            height={140}
            onLanguage={(locale) => void region.setLanguage(locale)}
            onFormats={(formats) => settings.patch("region", { formats })}
          />
        </Row>
      </Group>
      <Group>
        <Spot pane="language-region" row="first-day-of-week">
          <Row stack label="First day of the week">
            <Choices
              testID="region-first-day"
              value={chosen.firstWeekday ?? "auto"}
              options={WEEK_OPTIONS}
              onChange={(value) => settings.patch("region", { firstWeekday: value === "auto" ? undefined : value })}
            />
          </Row>
        </Spot>
        <Row stack label="Formats" detail="How dates, times, and numbers look in your region.">
          <View testID="region-preview" style={{ flexDirection: "column", gap: 3 }}>
            <Text style={{ fontSize: 12, color: colors.text }}>{`${preview.date}, ${preview.time}`}</Text>
            <Text style={{ fontSize: 12, color: colors.text }}>{preview.number}</Text>
            <View testID="region-week">
              <Text style={{ fontSize: 12, color: colors.textMuted }}>{days.join("  ")}</Text>
            </View>
          </View>
        </Row>
      </Group>
      {state.busy === "language" && <Caption>Changing it. If a password sheet appears, enter your password there.</Caption>}
      {state.error !== null && (
        <View testID="region-error" style={{ flexShrink: 0, paddingHorizontal: 4 }}>
          <Text style={{ fontSize: 11, color: colors.critical }}>{describeFailure(state.error)}</Text>
        </View>
      )}
      <Caption>
        The language applies to apps you open after you log in again. Dashi's own menus are English for now. Region formats apply to apps you open from now on.
      </Caption>
    </Page>
  );
}
