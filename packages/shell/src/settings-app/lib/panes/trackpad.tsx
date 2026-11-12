/**
 * Trackpad: tap to click, natural scrolling, tracking and scrolling speed, how a click is
 * told apart, and whether the pad sleeps while you type. Written to
 * settings.json `input.touchpad`; a setting never touched is the device's own
 * default (libinput's), which is what the switches show until then.
 */

import { Caption, Group } from "../../../shared/cards/index.ts";
import { useSettings } from "../../hooks.ts";
import type { SettingsStore } from "../../store.ts";
import { Page } from "../../ui.tsx";
import { DEFAULTS } from "../controls.ts";
import { Setting } from "../setting.tsx";
import { ScrollSpeedRow, SpeedRow } from "./speed-row.tsx";

export function TrackpadPane({ settings }: { settings: SettingsStore }) {
  const { touchpad } = useSettings(settings).data;
  return (
    <Page title="Trackpad">
      <Group>
        <Setting id="trackpad/tap-to-click" control="trackpad-tap" />
        <Setting id="trackpad/natural-scrolling" control="trackpad-natural" />
        <Setting id="trackpad/ignore-while-typing" control="trackpad-dwt" />
        <SpeedRow
          id="trackpad/tracking-speed"
          testID="trackpad-speed"
          value={touchpad.accelSpeed ?? DEFAULTS.accelSpeed}
          onCommit={(accelSpeed) => settings.patch("touchpad", { accelSpeed })}
        />
        <ScrollSpeedRow
          id="trackpad/scrolling-speed"
          testID="trackpad-scroll-speed"
          value={touchpad.scrollSpeed}
          onCommit={(scrollSpeed) => settings.patch("touchpad", { scrollSpeed })}
        />
        <Setting id="trackpad/click" stack={false} control="trackpad-click" />
      </Group>
      <Caption>With no touchpad connected, these apply when one is plugged in.</Caption>
    </Page>
  );
}
