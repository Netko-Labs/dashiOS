/**
 * Language & Region: the system language (through localed, with your
 * password when it must), the region whose formats dates, times, and
 * numbers follow, and the first day of the week. The language is the
 * computer's; the region and the first day are this person's (settings.json
 * `region`).
 */

import { Text, View } from "@mirinjs/metal";
import { LocalePickers } from "../../region/pickers.tsx";
import { describeFailure, type RegionStore, useRegion } from "../../region/store.ts";
import { useClockPrefs, useMinuteClock } from "../../shared/time/clock.ts";
import { firstDayIndex, previewFormats, weekdayNames } from "../../shared/time/week.ts";
import { useColors } from "../colors.ts";
import { useSettings } from "../hooks.ts";
import type { SettingsStore } from "../store.ts";
import { Caption, Group, Page, Setting } from "../ui.tsx";

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
        <Setting id="language-region/language" detail={`Language: ${language?.label ?? state.language ?? "not set"} · Formats: ${formatsLabel}`}>
          <LocalePickers
            locales={state.locales}
            language={state.language}
            formats={chosen.formats}
            height={140}
            onLanguage={(locale) => void region.setLanguage(locale)}
            onFormats={(formats) => settings.patch("region", { formats })}
          />
        </Setting>
      </Group>
      <Group>
        <Setting id="language-region/first-day-of-week" stack={false} control="region-first-day" />
        <Setting id="language-region/formats">
          <View testID="region-preview" style={{ flexDirection: "column", gap: 3 }}>
            <Text style={{ fontSize: 12, color: colors.text }}>{`${preview.date}, ${preview.time}`}</Text>
            <Text style={{ fontSize: 12, color: colors.text }}>{preview.number}</Text>
            <View testID="region-week">
              <Text style={{ fontSize: 12, color: colors.textMuted }}>{days.join("  ")}</Text>
            </View>
          </View>
        </Setting>
      </Group>
      {state.busy === "language" && <Caption>Changing it. If a password sheet appears, enter your password there.</Caption>}
      {state.error !== null && (
        <View testID="region-error" style={{ flexShrink: 0, paddingHorizontal: 10 }}>
          <Text style={{ fontSize: 11, color: colors.critical }}>{describeFailure(state.error)}</Text>
        </View>
      )}
      <Caption>
        The language applies to apps you open after you log in again. Dashi's own menus are English for now. Region formats apply to apps you open from now on.
      </Caption>
    </Page>
  );
}
