/**
 * Date & Time: the time zone (set through timedated, which asks for your
 * password through the shell's sheet when it must), whether the clock is
 * set from the network, 24-hour time, and the date in the menu bar. The
 * last two are this person's (settings.json `clock`); the clocks of the
 * shell follow them at once.
 */

import { View } from "@mirinjs/metal";
import { TimezonePicker } from "../../../region/pickers.tsx";
import { describeFailure, type RegionStore, useRegion } from "../../../region/store.ts";
import { describeZone, type Zone } from "../../../region/timezones.ts";
import { Caption, Group } from "../../../shared/cards/index.ts";
import { paneTitle } from "../../../shared/settings/index.ts";
import { formatClock, useClockPrefs, useMinuteClock, usesHour24 } from "../../../shared/time/index.ts";
import { useSettings } from "../../hooks.ts";
import type { SettingsStore } from "../../store.ts";
import { Page, Switch } from "../../ui.tsx";
import { Setting } from "../setting.tsx";
import { Failure } from "./parts.tsx";

/** A time zone by its city, country and offset ("Bogota · Colombia · GMT-5"), never its database id (VO-11, SE-A28). */
export function zoneWords(id: string, zone: Zone | undefined): string {
  if (!zone) return (id.split("/").at(-1) ?? id).replaceAll("_", " ");
  return [zone.city, describeZone(zone)].filter(Boolean).join(" · ");
}

export function DateTimePane({ region, settings }: { region: RegionStore; settings: SettingsStore }) {
  const state = useRegion(region);
  const prefs = useClockPrefs();
  const now = useMinuteClock();
  const { clock } = useSettings(settings).data;
  const zone = state.zones.find((candidate) => candidate.id === state.timezone);
  return (
    <Page title={paneTitle("date-time")}>
      <Group>
        <Setting
          id="date-time/automatic-time"
          detail={
            state.canNtp
              ? state.ntp
                ? state.ntpSynced
                  ? "Synchronized with a time server."
                  : "Waiting for a time server."
                : "The clock is set by hand."
              : "No time service is installed on this computer."
          }
        >
          <Switch testID="datetime-ntp" on={state.ntp} onChange={(on) => state.canNtp && void region.setNtp(on)} />
        </Setting>
        <Setting id="date-time/24-hour-time" detail={clock.hour24 === undefined ? "Follows your region." : null}>
          <Switch testID="datetime-24h" on={usesHour24(prefs)} onChange={(hour24) => settings.patch("clock", { hour24 })} />
        </Setting>
        <Setting id="date-time/show-date" control="datetime-show-date" />
      </Group>
      <View testID="datetime-preview">
        <Caption>{`The menu bar reads: ${formatClock(now, prefs)}`}</Caption>
      </View>
      <Group>
        <Setting id="date-time/time-zone" detail={zoneWords(state.timezone, zone)}>
          <TimezonePicker zones={state.zones} current={state.timezone} height={150} onPick={(id) => void region.setTimezone(id)} />
        </Setting>
      </Group>
      {state.busy !== null && <Caption>Changing it. If a password sheet appears, enter your password there.</Caption>}
      {state.error !== null && <Failure testID="datetime-error">{describeFailure(state.error)}</Failure>}
      {state.available === false && <Caption>This computer has no time service, so the time zone and clock sync cannot be changed here.</Caption>}
    </Page>
  );
}
