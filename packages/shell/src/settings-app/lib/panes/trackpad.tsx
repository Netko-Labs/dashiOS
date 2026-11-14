/**
 * Trackpad: on or off (the laptop's trackpad key too), ignored while a mouse is connected, tap to click, natural scrolling, tracking and scrolling speed, how a click is
 * told apart, and whether the pad sleeps while you type. Written to
 * settings.json `input.touchpad`; a setting never touched is the device's own
 * default (libinput's), which is what the switches show until then.
 */

import type { Pointers } from "../../../compositor/index.ts";
import { Caption, Group } from "../../../shared/cards/index.ts";
import { type PointerDevices, usePointers } from "../../../system/pointers.ts";
import { useSettings } from "../../hooks.ts";
import type { SettingsStore } from "../../store.ts";
import { Page } from "../../ui.tsx";
import { DEFAULTS } from "../controls.ts";
import { Setting } from "../setting.tsx";
import { ScrollSpeedRow, SpeedRow } from "./speed-row.tsx";

/** What the row says while the pad is ignored: a mouse is connected and the switch is on. */
export function ignoredDetail(offWithMouse: boolean | undefined, pointers: Pointers | null): string | undefined {
  return offWithMouse === true && pointers?.mouse === true ? "A mouse is connected: the pad is ignored now." : undefined;
}

export function TrackpadPane({ settings, pointers: devices }: { settings: SettingsStore; pointers?: PointerDevices | null }) {
  const { touchpad } = useSettings(settings).data;
  const pointers = usePointers(devices);
  // dashi-comp says there is no trackpad: no switch to turn one off; the rest waits for one, as the caption says.
  const none = pointers?.touchpad === false;
  const ignored = ignoredDetail(touchpad.offWithMouse, pointers);
  return (
    <Page title="Trackpad">
      {none ? null : (
        <Group>
          <Setting id="trackpad/on" control="trackpad-on" />
          <Setting id="trackpad/ignore-with-mouse" control="trackpad-ignore-with-mouse" {...(ignored !== undefined ? { detail: ignored } : {})} />
        </Group>
      )}
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
      {/* A trackpad dashi-comp says is there needs no word about one being plugged in. */}
      {pointers?.touchpad === true ? null : (
        <Caption>
          {none ? "This computer has no trackpad. These apply when one is plugged in." : "With no touchpad connected, these apply when one is plugged in."}
        </Caption>
      )}
    </Page>
  );
}
