/** Mouse: natural scrolling, tracking and scrolling speed, and the acceleration curve. Written to settings.json `input.mouse`. */

import { Switch } from "../../wifi/switch.tsx";
import { DEFAULTS } from "../controls.ts";
import { useSettings } from "../hooks.ts";
import type { SettingsStore } from "../store.ts";
import { Caption, Choices, Group, Page, Row, Spot } from "../ui.tsx";
import { ScrollSpeedRow, SpeedRow } from "./speed-row.tsx";

export function MousePane({ settings }: { settings: SettingsStore }) {
  const { mouse } = useSettings(settings).data;
  return (
    <Page title="Mouse">
      <Group>
        <Row label="Natural scrolling" detail="Content follows the wheel as if you pushed it.">
          <Switch testID="mouse-natural" on={mouse.naturalScroll ?? false} onChange={(naturalScroll) => settings.patch("mouse", { naturalScroll })} />
        </Row>
        <SpeedRow testID="mouse-speed" value={mouse.accelSpeed ?? DEFAULTS.accelSpeed} onCommit={(accelSpeed) => settings.patch("mouse", { accelSpeed })} />
        <Spot pane="mouse" row="scrolling-speed">
          <ScrollSpeedRow testID="mouse-scroll-speed" value={mouse.scrollSpeed} onCommit={(scrollSpeed) => settings.patch("mouse", { scrollSpeed })} />
        </Spot>
        <Row stack label="Acceleration" detail="Adaptive speeds up the pointer when the mouse moves fast; flat keeps it steady.">
          <Choices
            testID="mouse-profile"
            value={mouse.accelProfile ?? "adaptive"}
            options={[
              { value: "adaptive", label: "Adaptive" },
              { value: "flat", label: "Flat" },
            ]}
            onChange={(accelProfile) => settings.patch("mouse", { accelProfile })}
          />
        </Row>
      </Group>
      <Caption>With no mouse connected, these apply when one is plugged in.</Caption>
    </Page>
  );
}
