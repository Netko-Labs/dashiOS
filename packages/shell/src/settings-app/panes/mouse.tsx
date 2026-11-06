/** Mouse: natural scrolling, tracking and scrolling speed, and the acceleration curve. Written to settings.json `input.mouse`. */

import { DEFAULTS } from "../controls.ts";
import { useSettings } from "../hooks.ts";
import type { SettingsStore } from "../store.ts";
import { Caption, Group, Page, Setting } from "../ui.tsx";
import { ScrollSpeedRow, SpeedRow } from "./speed-row.tsx";

export function MousePane({ settings }: { settings: SettingsStore }) {
  const { mouse } = useSettings(settings).data;
  return (
    <Page title="Mouse">
      <Group>
        <Setting id="mouse/natural-scrolling" control="mouse-natural" />
        <SpeedRow
          id="mouse/tracking-speed"
          testID="mouse-speed"
          value={mouse.accelSpeed ?? DEFAULTS.accelSpeed}
          onCommit={(accelSpeed) => settings.patch("mouse", { accelSpeed })}
        />
        <ScrollSpeedRow
          id="mouse/scrolling-speed"
          testID="mouse-scroll-speed"
          value={mouse.scrollSpeed}
          onCommit={(scrollSpeed) => settings.patch("mouse", { scrollSpeed })}
        />
        <Setting id="mouse/acceleration" control="mouse-profile" />
      </Group>
      <Caption>With no mouse connected, these apply when one is plugged in.</Caption>
    </Page>
  );
}
