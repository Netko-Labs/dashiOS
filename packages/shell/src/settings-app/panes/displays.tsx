/**
 * Displays (docs/design.html, "Settings"): its hero is the display at its
 * real shape with its facts, and the title names it ("Displays ·
 * Built-in"). With several, each is in the hero and a press chooses which
 * the cards change; Arrange turns the hero into the arrangement to drag
 * (edges snap). Then the common choices: the built-in screen's brightness
 * (Control Center's slider), the refresh rate (Automatic first where the
 * built-in screen offers it: its top rate plugged in, about 60 Hz on
 * battery, display-config/auto-refresh.ts), the scale (the nearest four,
 * "More" for the rest), and Night Shift. Resolution, rotation and the
 * rest sit under it (display-cards.tsx), so the pane stays short. A scale
 * applies at once and is remembered for the next session; resolution,
 * rotation, and turning a screen off are tried first and asked about
 * ("Keep these settings?", display-config/), so a mode a monitor cannot
 * show comes back by itself.
 */

import { Text, View } from "@mirinjs/metal";
import { useCallback, useState, useSyncExternalStore } from "react";
import { type DeviceStore, useDevices } from "../../control-center/devices.ts";
import type { AutoRefresh, RefreshScreen } from "../../display-config/auto-refresh.ts";
import { mirrorSource } from "../../display-config/mirror.ts";
import { type Mode, type Monitor, monitorLabel, ratesOf, sizeLabel } from "../../display-config/monitors.ts";
import type { ScreenInfo } from "../../displays.ts";
import type { Laptop } from "../../laptop/start.ts";
import { selectedRef } from "../../wallpaper/catalog.ts";
import { wallpaperTiles } from "../../wallpaper/tiles.ts";
import { useColors } from "../colors.ts";
import { chosenMonitor, displayHero, scaleOffer } from "../heroes.ts";
import { useScreens, useSettings } from "../hooks.ts";
import { SUN } from "../knob-glyphs.ts";
import { describeSchedule } from "../night.ts";
import { isCurrentScale, logicalSize, type ScreensStore, scaleChoices, scaleLabel } from "../screens.ts";
import type { SettingsStore } from "../store.ts";
import { Button, Caption, Choices, Group, Hero, Note, Page, Setting, Slider, Switch } from "../ui.tsx";
import { ArrangementView } from "./arrangement.tsx";
import { OffScreenCard, ScreenDetails, X11AppsSection } from "./display-cards.tsx";
import { DisplayHero } from "./display-hero.tsx";
import { PanelOverdriveSection } from "./laptop-parts.tsx";
import { NightShiftSection } from "./night-shift.tsx";

/** What Automatic refresh rate says of this screen; null without it (no built-in screen, a test). */
function useRefreshScreen(refresh: AutoRefresh | null, name: string): RefreshScreen | null {
  const subscribe = useCallback((listener: () => void) => refresh?.subscribe(listener) ?? (() => {}), [refresh]);
  return useSyncExternalStore(subscribe, () => refresh?.getSnapshot().screens.find((screen) => screen.name === name) ?? null);
}

const AUTOMATIC = "automatic";

/** No device store (a test): no backlight. */
const NO_DEVICE_READING = { wifi: null, bluetooth: null, brightness: null, volume: null, hotspot: null };
const NO_DEVICES = { subscribe: () => () => {}, getSnapshot: () => NO_DEVICE_READING } as unknown as DeviceStore;

/** A rate as its pill says it: "120", "59.95". */
const hertz = (refreshMhz: number): string => {
  const value = Math.round(refreshMhz / 10) / 100;
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
};

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
    <Setting id="displays/refresh-rate" stack={false} detail={automatic && auto ? `Automatic: ${auto.decision.why}` : `${hertz(current)} Hz`}>
      <Choices<number | string>
        testID={`display-refresh:${monitor.name}`}
        options={[...(offered ? [{ value: AUTOMATIC, label: "Auto" }] : []), ...rates.map((rate) => ({ value: rate, label: hertz(rate) }))]}
        value={automatic ? AUTOMATIC : current}
        onChange={(rate) => void store.setRate(monitor.name, typeof rate === "number" ? rate : AUTOMATIC)}
      />
    </Setting>
  );
}

/** The scale: the one in use and its neighbours as pills, "More" for the rest; the row says what the screen looks like. */
function Scale({ monitor, screen, store }: { monitor: Monitor; screen: ScreenInfo; store: ScreensStore }) {
  const choices = scaleChoices(screen);
  const current = choices.find((choice) => isCurrentScale(screen, choice)) ?? screen.scale;
  return (
    <Setting id="displays/scale" stack={false} detail={`Looks like ${sizeLabel(logicalSize(screen, screen.scale))}`}>
      <Choices
        testID={`display-scale:${monitor.name}`}
        options={choices.map((scale) => ({ value: scale, label: scaleLabel(scale) }))}
        common={scaleOffer(choices, current, 4).shown}
        value={current}
        onChange={(scale) => void store.setScale(monitor.name, scale)}
      />
    </Setting>
  );
}

/** The built-in screen's brightness, as Control Center's slider sets it (the pane leaves it out without a backlight). */
function Brightness({ devices, brightness }: { devices: DeviceStore; brightness: number }) {
  return (
    <Setting id="displays/brightness">
      <Slider
        testID="display-brightness"
        value={brightness}
        glyph={SUN}
        format={(level) => `${Math.round(level * 100)}%`}
        onChange={(level) => devices.setBrightnessLevel(level)}
      />
    </Setting>
  );
}

/** Night Shift's switch, the same as Control Center's tile, with its schedule in words. */
function NightShiftRow({ settings }: { settings: SettingsStore }) {
  const { nightShift } = useSettings(settings).data;
  return <Setting id="displays/night-shift" detail={describeSchedule(nightShift.from, nightShift.to)} control="night-switch" />;
}

/** Mirroring: the other displays show the built-in one (the main one without it), as Control Center's tile does. */
function MirrorRow({ monitors, store }: { monitors: readonly Monitor[]; store: ScreensStore }) {
  const mirrored = monitors.find((monitor) => monitor.mirrorOf !== undefined);
  const sourceName = mirrored?.mirrorOf ?? mirrorSource(monitors);
  const source = monitors.find((monitor) => monitor.name === sourceName);
  if (!source) return null;
  const label = monitorLabel(source);
  return (
    <Setting id="displays/mirror" detail={mirrored ? `The others show ${label}` : `The others would show ${label}`}>
      <Switch testID="displays-mirror-switch" on={mirrored !== undefined} onChange={(on) => void store.setMirroring(on)} />
    </Setting>
  );
}

/** The picture the hero's screens show: the wallpaper's tile, else the default one. */
function useWallpaperPicture(settings: SettingsStore): string {
  const { wallpaper } = useSettings(settings).data;
  const tiles = wallpaperTiles(wallpaper.photos ?? []);
  const ref = selectedRef({ path: wallpaper.path, mode: wallpaper.mode ?? "fill" });
  return tiles.find((tile) => tile.ref === ref)?.image ?? tiles[0]?.image ?? "";
}

export function DisplaysPane({
  screens,
  settings,
  laptop,
  refresh,
  devices,
}: {
  screens: ScreensStore;
  settings: SettingsStore;
  laptop?: Laptop | null;
  refresh?: AutoRefresh | null;
  devices?: DeviceStore | null;
}) {
  const colors = useColors();
  const state = useScreens(screens);
  const wallpaper = useWallpaperPicture(settings);
  const [asked, setAsked] = useState<string | null>(null);
  const [arranging, setArranging] = useState(false);
  const on = state.monitors.filter((monitor) => monitor.enabled);
  const off = state.monitors.filter((monitor) => !monitor.enabled);
  const monitor = chosenMonitor(state.monitors, asked);
  const screen = monitor ? state.screens.find((each) => each.name === monitor.name) : undefined;
  const several = on.length > 1;
  const name = monitor ? displayHero(monitor, { width: 1, height: 1 }).name : undefined;
  // A row that has nothing to show is left out here, so the card draws no hairline for it.
  const { brightness } = useDevices(devices ?? NO_DEVICES);
  const rates = monitor?.mode ? ratesOf(monitor.modes, monitor.mode).length : 0;
  return (
    <Page title="Displays" {...(name ? { detail: name } : {})}>
      {state.loaded && state.screens.length === 0 && state.monitors.length === 0 && (
        <Group>
          <Note testID="displays-none">No displays are reported by the compositor.</Note>
        </Group>
      )}
      {monitor && (
        <Hero testID="displays-hero-card">
          {arranging && several ? (
            <View style={{ flex: 1, alignItems: "center" }}>
              <ArrangementView monitors={state.monitors} onMove={(moved, spot) => void screens.arrange({ [moved]: spot })} />
            </View>
          ) : (
            <DisplayHero monitors={state.monitors} chosen={monitor.name} rateRow={rates > 1} wallpaper={wallpaper} onChoose={setAsked} />
          )}
        </Hero>
      )}
      {monitor?.mode && (
        <Group testID={`display:${monitor.name}`}>
          {monitor.builtIn && devices && brightness !== null && <Brightness devices={devices} brightness={brightness} />}
          {rates > 1 && <RefreshRate monitor={{ ...monitor, mode: monitor.mode }} store={screens} refresh={refresh ?? null} />}
          {screen && <Scale monitor={monitor} screen={screen} store={screens} />}
          <NightShiftRow settings={settings} />
        </Group>
      )}
      {monitor && (
        <Group testID="displays-arrange">
          <Setting id="displays/arrange" detail={several ? `${on.length} displays connected` : "One display connected"}>
            <Button testID="displays-arrange-button" label={arranging ? "Done" : "Arrange"} disabled={!several} onPress={() => setArranging((now) => !now)} />
          </Setting>
          {several && <MirrorRow monitors={state.monitors} store={screens} />}
        </Group>
      )}
      {monitor?.mode && <ScreenDetails monitor={monitor} store={screens} canTurnOff={several} />}
      {off.map((each) => (
        <OffScreenCard key={each.name} monitor={each} store={screens} />
      ))}
      {state.error !== null && (
        <View testID="displays-error" style={{ flexShrink: 0, paddingLeft: 10 }}>
          <Text style={{ fontSize: 11.5, color: colors.critical }}>The displays didn't answer, so nothing changed. Try again in a moment.</Text>
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
