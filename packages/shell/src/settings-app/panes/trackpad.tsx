/**
 * Trackpad: tap to click, natural scrolling, tracking and scrolling speed, how a click is
 * told apart, and whether the pad sleeps while you type. Written to
 * settings.json `input.touchpad`; a setting never touched is the device's own
 * default (libinput's), which is what the switches show until then.
 */

import { Switch } from "../../wifi/switch.tsx";
import { DEFAULTS } from "../controls.ts";
import { useSettings } from "../hooks.ts";
import type { SettingsStore } from "../store.ts";
import { Caption, Choices, Group, Page, Row } from "../ui.tsx";
import { ScrollSpeedRow, SpeedRow } from "./speed-row.tsx";

export function TrackpadPane({ settings }: { settings: SettingsStore }) {
  const { touchpad } = useSettings(settings).data;
  return (
    <Page title="Trackpad">
      <Group>
        <Row label="Tap to click" detail="Tap the pad with one finger instead of pressing it.">
          <Switch testID="trackpad-tap" on={touchpad.tap ?? false} onChange={(tap) => settings.patch("touchpad", { tap })} />
        </Row>
        <Row label="Natural scrolling" detail="Content follows your fingers.">
          <Switch testID="trackpad-natural" on={touchpad.naturalScroll ?? false} onChange={(naturalScroll) => settings.patch("touchpad", { naturalScroll })} />
        </Row>
        <Row label="Ignore the pad while typing" detail="Keeps a resting palm from moving the pointer.">
          <Switch
            testID="trackpad-dwt"
            on={touchpad.disableWhileTyping ?? true}
            onChange={(disableWhileTyping) => settings.patch("touchpad", { disableWhileTyping })}
          />
        </Row>
        <SpeedRow
          testID="trackpad-speed"
          value={touchpad.accelSpeed ?? DEFAULTS.accelSpeed}
          onCommit={(accelSpeed) => settings.patch("touchpad", { accelSpeed })}
        />
        <ScrollSpeedRow testID="trackpad-scroll-speed" value={touchpad.scrollSpeed} onCommit={(scrollSpeed) => settings.patch("touchpad", { scrollSpeed })} />
        <Row stack label="Click" detail="How the pad tells a left click from a right click.">
          <Choices
            testID="trackpad-click"
            value={touchpad.clickMethod ?? "buttonAreas"}
            options={[
              { value: "buttonAreas", label: "Bottom corners" },
              { value: "clickfinger", label: "Number of fingers" },
            ]}
            onChange={(clickMethod) => settings.patch("touchpad", { clickMethod })}
          />
        </Row>
      </Group>
      <Caption>With no touchpad connected, these apply when one is plugged in.</Caption>
    </Page>
  );
}
