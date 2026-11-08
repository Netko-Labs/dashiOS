/**
 * Displays: the arrangement of the screens (drag to move one, edges snap),
 * then each screen with its resolution, refresh rate, rotation, and scale,
 * and which is the main display. A built-in screen with a lower rate offers
 * Automatic refresh rate first (display-config/auto-refresh.ts): its top rate
 * plugged in, about 60 Hz on battery, with a line saying which it runs now. A scale applies at once and is remembered
 * for the next session; resolution, rotation, and turning a screen off are
 * tried first and asked about ("Keep these settings?", display-config/), so
 * a mode a monitor cannot show comes back by itself. Night Shift is the
 * section below the screens.
 */

import { useColors } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import { useCallback, useState, useSyncExternalStore } from "react";
import type { AutoRefresh, RefreshScreen } from "../../display-config/auto-refresh.ts";
import {
  commonSizes,
  type Mode,
  type Monitor,
  modeFor,
  monitorLabel,
  ROTATIONS,
  type Rotation,
  ratesOf,
  refreshLabel,
  sizeLabel,
  sizesOf,
  VRR_MODES,
  type VrrMode,
} from "../../display-config/monitors.ts";
import type { ScreenInfo } from "../../displays.ts";
import type { Laptop } from "../../laptop/start.ts";
import { DISPLAY } from "../glyphs.ts";
import { useScreens } from "../hooks.ts";
import { isCurrentScale, logicalSize, type ScreensStore, scaleChoices, scaleLabel } from "../screens.ts";
import type { SettingsStore } from "../store.ts";
import { Button, Caption, Choices, Group, Note, Page, Setting } from "../ui.tsx";
import { ArrangementView } from "./arrangement.tsx";
import { PanelOverdriveSection } from "./laptop-parts.tsx";
import { NightShiftSection } from "./night-shift.tsx";

const ROTATION_LABELS: Record<Rotation, string> = { 0: "Standard", 90: "90°", 180: "180°", 270: "270°" };
const VRR_LABELS: Record<VrrMode, string> = { off: "Off", on: "On", fullscreen: "Full Screen Only" };

function Heading({ monitor }: { monitor: Monitor }) {
  const colors = useColors();
  const size = monitor.mode
    ? sizeLabel(monitor.rotation === 90 || monitor.rotation === 270 ? { width: monitor.mode.height, height: monitor.mode.width } : monitor.mode)
    : "Off";
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 12 }}>
      <Svg markup={DISPLAY} size={30} color={colors.textMuted} />
      <View style={{ flex: 1, flexDirection: "column", gap: 1 }}>
        <Text style={{ fontSize: 14, fontWeight: "semibold", color: colors.text }}>{monitor.name}</Text>
        <Text style={{ fontSize: 11, color: colors.textMuted }}>
          {[size, monitor.primary ? "Main display" : "", monitor.builtIn ? "Built-in display" : ""].filter((part) => part !== "").join(" · ")}
        </Text>
      </View>
      {monitor.model !== "" && !monitor.builtIn && monitor.model !== monitor.name && (
        <Text style={{ fontSize: 11, color: colors.textMuted }}>{monitorLabel(monitor)}</Text>
      )}
    </View>
  );
}

/** What Automatic refresh rate says of this screen; null without it (no built-in screen, a test). */
function useRefreshScreen(refresh: AutoRefresh | null, name: string): RefreshScreen | null {
  const subscribe = useCallback((listener: () => void) => refresh?.subscribe(listener) ?? (() => {}), [refresh]);
  return useSyncExternalStore(subscribe, () => refresh?.getSnapshot().screens.find((screen) => screen.name === name) ?? null);
}

const AUTOMATIC = "automatic";

/** The refresh rate row: Automatic first where the screen offers it, then the rates at its size, fastest first. */
function RefreshRate({ monitor, store, refresh }: { monitor: Monitor & { mode: Mode }; store: ScreensStore; refresh: AutoRefresh | null }) {
  const auto = useRefreshScreen(refresh, monitor.name);
  const mode = monitor.mode;
  const rates = ratesOf(monitor.modes, mode);
  if (rates.length <= 1) return null;
  const offered = auto?.decision.offered === true;
  const automatic = offered && auto?.choice === "automatic";
  const current = rates.find((rate) => Math.abs(rate - mode.refreshMhz) <= 600) ?? mode.refreshMhz;
  return (
    <Setting id="displays/refresh-rate" {...(automatic && auto ? { detail: `${auto.decision.why}.` } : {})}>
      <Choices<number | string>
        testID={`display-refresh:${monitor.name}`}
        options={[...(offered ? [{ value: AUTOMATIC, label: "Automatic" }] : []), ...rates.map((rate) => ({ value: rate, label: refreshLabel(rate) }))]}
        value={automatic ? AUTOMATIC : current}
        onChange={(rate) => void store.setRate(monitor.name, typeof rate === "number" ? rate : AUTOMATIC)}
      />
    </Setting>
  );
}

function ScreenCard({
  monitor,
  screen,
  store,
  canTurnOff,
  refresh,
}: {
  monitor: Monitor;
  screen: ScreenInfo | undefined;
  store: ScreensStore;
  canTurnOff: boolean;
  refresh: AutoRefresh | null;
}) {
  const [showAll, setShowAll] = useState(false);
  const { name } = monitor;
  if (!monitor.enabled || !monitor.mode) {
    return (
      <Group testID={`display:${name}`}>
        <Heading monitor={monitor} />
        <Setting id="displays/turned-off">
          <Button testID={`display-on:${name}`} label="Turn On" onPress={() => void store.setEnabled(name, true)} />
        </Setting>
      </Group>
    );
  }
  const mode = monitor.mode;
  const here = { width: mode.width, height: mode.height };
  const every = sizesOf(monitor.modes);
  const common = commonSizes(monitor.modes, here);
  const sizes = showAll || common.length >= every.length ? every : common;
  const choices = screen ? scaleChoices(screen).map((scale) => ({ value: scale, label: scaleLabel(scale) })) : [];
  const current = screen ? (choices.find((choice) => isCurrentScale(screen, choice.value))?.value ?? screen.scale) : monitor.scale;
  const looks = screen ? logicalSize(screen, screen.scale) : null;
  return (
    <Group testID={`display:${name}`}>
      <Heading monitor={monitor} />
      {every.length > 1 && (
        <Setting id="displays/resolution" detail={`${sizeLabel(here)} now`}>
          <Choices
            testID={`display-resolution:${name}`}
            options={sizes.map((size) => ({
              value: sizeLabel(size),
              label: monitor.modes.some((offered) => offered.preferred && offered.width === size.width && offered.height === size.height)
                ? `${sizeLabel(size)} (native)`
                : sizeLabel(size),
            }))}
            value={sizeLabel(here)}
            onChange={(label) => {
              const size = sizes.find((candidate) => sizeLabel(candidate) === label);
              const next = size && modeFor(monitor.modes, size, mode.refreshMhz);
              if (next) void store.setMode(name, { width: next.width, height: next.height, refreshMhz: next.refreshMhz });
            }}
          />
          {common.length < every.length && (
            <View style={{ flexDirection: "row" }}>
              <Button
                testID={`display-all-resolutions:${name}`}
                label={showAll ? "Show Fewer" : "Show All Resolutions"}
                onPress={() => setShowAll((shown) => !shown)}
              />
            </View>
          )}
        </Setting>
      )}
      <RefreshRate monitor={{ ...monitor, mode }} store={store} refresh={refresh} />
      {monitor.vrr.supported && (
        <Setting id="displays/variable-refresh-rate" detail={monitor.vrr.active ? "Following the frames now." : undefined}>
          <Choices
            testID={`display-vrr:${name}`}
            options={VRR_MODES.map((mode) => ({ value: mode, label: VRR_LABELS[mode] }))}
            value={monitor.vrr.mode}
            onChange={(mode) => void store.setVrr(name, mode)}
          />
        </Setting>
      )}
      <Setting id="displays/rotation">
        <Choices
          testID={`display-rotation:${name}`}
          options={ROTATIONS.map((rotation) => ({ value: rotation, label: ROTATION_LABELS[rotation] }))}
          value={monitor.rotation}
          onChange={(rotation) => void store.setRotation(name, rotation)}
        />
      </Setting>
      {screen && (
        <Setting id="displays/scale" detail={looks ? `Looks like ${looks.width} × ${looks.height}` : null}>
          <Choices testID={`display-scale:${name}`} options={choices} value={current} onChange={(scale) => void store.setScale(name, scale)} />
        </Setting>
      )}
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

/** How X11 apps meet a scaled screen (settings.json `appearance.x11Apps`, xwayland-scale.ts). */
function X11AppsSection() {
  return (
    <>
      <Group>
        <Setting id="displays/x11-apps" detail={null} control="displays-x11-apps" />
      </Group>
      <Caption>
        Sharp draws X11 apps such as Steam at the screen's full detail; an app that can't size itself comes out small. Stretched keeps every X11 app the right
        size, a little soft. Apps opened after the change follow it.
      </Caption>
    </>
  );
}

export function DisplaysPane({
  screens,
  settings,
  laptop,
  refresh,
}: {
  screens: ScreensStore;
  settings: SettingsStore;
  laptop?: Laptop | null;
  refresh?: AutoRefresh | null;
}) {
  const colors = useColors();
  const state = useScreens(screens);
  const on = state.monitors.filter((monitor) => monitor.enabled);
  const sorted = [...on, ...state.monitors.filter((monitor) => !monitor.enabled)];
  return (
    <Page title="Displays">
      {state.loaded && state.screens.length === 0 && state.monitors.length === 0 && (
        <Group>
          <Note testID="displays-none">No displays are reported by the compositor.</Note>
        </Group>
      )}
      {on.length > 1 && (
        <>
          <Caption above>Arrangement</Caption>
          <ArrangementView monitors={state.monitors} onMove={(name, spot) => void screens.arrange({ [name]: spot })} />
          <Caption>Drag the screens to match how they sit on your desk. The bar marks the main display.</Caption>
        </>
      )}
      {sorted.map((monitor) => (
        <ScreenCard
          key={monitor.name}
          monitor={monitor}
          screen={state.screens.find((screen) => screen.name === monitor.name)}
          store={screens}
          canTurnOff={on.length > 1}
          refresh={refresh ?? null}
        />
      ))}
      {state.error !== null && (
        <View testID="displays-error" style={{ flexShrink: 0 }}>
          <Text style={{ fontSize: 11, color: colors.critical }}>The displays didn't answer, so nothing changed. Try again in a moment.</Text>
        </View>
      )}
      <Caption>
        Windows move with the screen when its scale changes. The choice is kept for the next login. A new resolution or rotation goes back by itself unless you
        keep it.
      </Caption>
      <PanelOverdriveSection laptop={laptop ?? null} />
      <X11AppsSection />
      <NightShiftSection settings={settings} />
    </Page>
  );
}
