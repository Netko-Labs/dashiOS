/**
 * Date & Time: the time zone (set through timedated, which asks for your
 * password through the shell's sheet when it must), whether the clock is
 * set from the network, 24-hour time, and the date in the menu bar. The
 * last two are this person's (settings.json `clock`); the clocks of the
 * shell follow them at once.
 */

import { Text, View } from "@mirinjs/metal";
import { formatClock, usesHour24, useClockPrefs, useMinuteClock } from "../../clock.ts";
import { TimezonePicker } from "../../region/pickers.tsx";
import { describeFailure, type RegionStore, useRegion } from "../../region/store.ts";
import { describeZone } from "../../region/timezones.ts";
import { useColors } from "../../theme.ts";
import { Switch } from "../../wifi/switch.tsx";
import { useSettings } from "../hooks.ts";
import type { SettingsStore } from "../store.ts";
import { Caption, Group, Page, Row } from "../ui.tsx";

export function DateTimePane({ region, settings }: { region: RegionStore; settings: SettingsStore }) {
  const colors = useColors();
  const state = useRegion(region);
  const prefs = useClockPrefs();
  const now = useMinuteClock();
  const { clock } = useSettings(settings).data;
  const zone = state.zones.find((candidate) => candidate.id === state.timezone);
  return (
    <Page title="Date & Time">
      <Group>
        <Row
          label="Set time and date automatically"
          detail={state.canNtp ? (state.ntp ? (state.ntpSynced ? "Synchronized with a time server." : "Waiting for a time server.") : "The clock is set by hand.") : "No time service is installed on this computer."}
        >
          <Switch testID="datetime-ntp" on={state.ntp} onChange={(on) => state.canNtp && void region.setNtp(on)} />
        </Row>
        <Row label="24-hour time" detail={clock.hour24 === undefined ? "Follows your region." : undefined}>
          <Switch testID="datetime-24h" on={usesHour24(prefs)} onChange={(hour24) => settings.patch("clock", { hour24 })} />
        </Row>
        <Row label="Show date in the menu bar">
          <Switch testID="datetime-show-date" on={clock.showDate ?? true} onChange={(showDate) => settings.patch("clock", { showDate })} />
        </Row>
      </Group>
      <View testID="datetime-preview" style={{ flexShrink: 0, paddingHorizontal: 4 }}>
        <Text style={{ fontSize: 11, color: colors.textMuted }}>{`The menu bar reads: ${formatClock(now, prefs)}`}</Text>
      </View>
      <Group>
        <Row stack label="Time zone" detail={`${state.timezone.replaceAll("_", " ")}${zone ? ` · ${describeZone(zone)}` : ""}`}>
          <TimezonePicker zones={state.zones} current={state.timezone} height={150} onPick={(id) => void region.setTimezone(id)} />
        </Row>
      </Group>
      {state.busy !== null && <Caption>Changing it. If a password sheet appears, enter your password there.</Caption>}
      {state.error !== null && (
        <View testID="datetime-error" style={{ flexShrink: 0, paddingHorizontal: 4 }}>
          <Text style={{ fontSize: 11, color: colors.critical }}>{describeFailure(state.error)}</Text>
        </View>
      )}
      {state.available === false && <Caption>This computer has no time service, so the time zone and clock sync cannot be changed here.</Caption>}
    </Page>
  );
}
