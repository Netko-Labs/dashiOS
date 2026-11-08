/**
 * The cards under Displays' common choices (displays.tsx): the chosen
 * display's resolution (its usual sizes, "More…" for the rest, "native" on
 * the native size's own pill where the screen has one), variable refresh
 * rate, rotation, the main display and turning it off; a card for each
 * display that is off, with Turn On; and how X11 apps meet a scaled screen.
 */

import {
  commonSizes,
  type Monitor,
  modeFor,
  nativeSize,
  ROTATIONS,
  type Rotation,
  sizeLabel,
  sizesOf,
  VRR_MODES,
  type VrrMode,
} from "../../display-config/monitors.ts";
import { displayHero } from "../heroes.ts";
import type { ScreensStore } from "../screens.ts";
import { Button, Caption, Choices, Group, Setting } from "../ui.tsx";

const ROTATION_LABELS: Record<Rotation, string> = { 0: "Standard", 90: "90°", 180: "180°", 270: "270°" };
const VRR_LABELS: Record<VrrMode, string> = { off: "Off", on: "On", fullscreen: "Full Screen Only" };

/** The chosen display's other choices, under the common ones. */
export function ScreenDetails({ monitor, store, canTurnOff }: { monitor: Monitor; store: ScreensStore; canTurnOff: boolean }) {
  const { name } = monitor;
  const mode = monitor.mode;
  if (!mode) return null;
  const here = { width: mode.width, height: mode.height };
  const every = sizesOf(monitor.modes);
  const native = nativeSize(monitor.modes);
  return (
    <Group testID={`display-details:${name}`}>
      {every.length > 1 && (
        // The chosen pill says the size; "native" is on the native size's own pill. Past five sizes, the usual four and "More…".
        <Setting id="displays/resolution" detail={null}>
          <Choices
            testID={`display-resolution:${name}`}
            options={every.map((size) => ({
              value: sizeLabel(size),
              label: native && size.width === native.width && size.height === native.height ? `${sizeLabel(size)} (native)` : sizeLabel(size),
            }))}
            common={commonSizes(monitor.modes, here).map(sizeLabel)}
            value={sizeLabel(here)}
            onChange={(label) => {
              const size = every.find((candidate) => sizeLabel(candidate) === label);
              const next = size && modeFor(monitor.modes, size, mode.refreshMhz);
              if (next) void store.setMode(name, { width: next.width, height: next.height, refreshMhz: next.refreshMhz });
            }}
          />
        </Setting>
      )}
      {monitor.vrr.supported && (
        <Setting id="displays/variable-refresh-rate" detail={monitor.vrr.active ? "Following the frames now." : undefined}>
          <Choices
            testID={`display-vrr:${name}`}
            options={VRR_MODES.map((each) => ({ value: each, label: VRR_LABELS[each] }))}
            value={monitor.vrr.mode}
            onChange={(each) => void store.setVrr(name, each)}
          />
        </Setting>
      )}
      <Setting id="displays/rotation" stack={false}>
        <Choices
          testID={`display-rotation:${name}`}
          options={ROTATIONS.map((rotation) => ({ value: rotation, label: ROTATION_LABELS[rotation] }))}
          value={monitor.rotation}
          onChange={(rotation) => void store.setRotation(name, rotation)}
        />
      </Setting>
      <Setting id="displays/main-display" detail={monitor.primary ? "The menu bar and Dock are here." : undefined}>
        {!monitor.primary && <Button testID={`display-main:${name}`} label="Use as Main Display" onPress={() => void store.setPrimary(name)} />}
      </Setting>
      {canTurnOff && (
        <Setting id="displays/turn-off">
          <Button testID={`display-off:${name}`} label="Turn Off" onPress={() => void store.setEnabled(name, false)} />
        </Setting>
      )}
    </Group>
  );
}

/** A display that is plugged in but off: its name, and Turn On. */
export function OffScreenCard({ monitor, store }: { monitor: Monitor; store: ScreensStore }) {
  const facts = displayHero(monitor, { width: 1, height: 1 }).name;
  return (
    <Group testID={`display:${monitor.name}`}>
      <Setting id="displays/turned-off" detail={`${facts}. It stays plugged in; its windows are on the other screens.`}>
        <Button testID={`display-on:${monitor.name}`} label="Turn On" onPress={() => void store.setEnabled(monitor.name, true)} />
      </Setting>
    </Group>
  );
}

/** How X11 apps meet a scaled screen (settings.json `appearance.x11Apps`, xwayland-scale.ts). */
export function X11AppsSection() {
  return (
    <>
      <Group>
        <Setting id="displays/x11-apps" detail={null} stack={false} control="displays-x11-apps" />
      </Group>
      <Caption>
        Sharp draws X11 apps such as Steam at the screen's full detail; an app that can't size itself comes out small. Stretched keeps every X11 app the right
        size, a little soft. Apps opened after the change follow it.
      </Caption>
    </>
  );
}
