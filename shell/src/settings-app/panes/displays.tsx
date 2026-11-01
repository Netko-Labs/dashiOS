/**
 * Displays: the arrangement of the screens (drag to move one, edges snap),
 * then each screen with its resolution, refresh rate, rotation, and scale,
 * and which is the main display. A scale applies at once and is remembered
 * for the next session; resolution, rotation, and turning a screen off are
 * tried first and asked about ("Keep these settings?", display-config/), so
 * a mode a monitor cannot show comes back by itself. Night Shift is the
 * section below the screens.
 */

import { Svg, Text, View } from "@mirinjs/metal";
import { useState } from "react";
import { commonSizes, type Monitor, monitorLabel, ratesOf, refreshLabel, ROTATIONS, type Rotation, sizeLabel, sizesOf, modeFor } from "../../display-config/monitors.ts";
import type { ScreenInfo } from "../../displays.ts";
import type { FlagsStore } from "../../control-center/flags.ts";
import { useColors } from "../../theme.ts";
import { useScreens } from "../hooks.ts";
import { DISPLAY } from "../glyphs.ts";
import { isCurrentScale, logicalSize, scaleChoices, scaleLabel, type ScreensStore } from "../screens.ts";
import type { SettingsStore } from "../store.ts";
import { Button, Caption, Choices, Group, Note, Page, Row } from "../ui.tsx";
import { ArrangementView } from "./arrangement.tsx";
import { NightShiftSection } from "./night-shift.tsx";

const ROTATION_LABELS: Record<Rotation, string> = { 0: "Standard", 90: "90°", 180: "180°", 270: "270°" };

function Heading({ monitor }: { monitor: Monitor }) {
  const colors = useColors();
  const size = monitor.mode ? sizeLabel(monitor.rotation === 90 || monitor.rotation === 270 ? { width: monitor.mode.height, height: monitor.mode.width } : monitor.mode) : "Off";
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 12 }}>
      <Svg markup={DISPLAY} size={30} color={colors.textMuted} />
      <View style={{ flex: 1, flexDirection: "column", gap: 1 }}>
        <Text style={{ fontSize: 14, fontWeight: "semibold", color: colors.text }}>{monitor.name}</Text>
        <Text style={{ fontSize: 11, color: colors.textMuted }}>{[size, monitor.primary ? "Main display" : "", monitor.builtIn ? "Built-in display" : ""].filter((part) => part !== "").join(" · ")}</Text>
      </View>
      {monitor.model !== "" && !monitor.builtIn && monitor.model !== monitor.name && <Text style={{ fontSize: 11, color: colors.textMuted }}>{monitorLabel(monitor)}</Text>}
    </View>
  );
}

function ScreenCard({ monitor, screen, store, canTurnOff }: { monitor: Monitor; screen: ScreenInfo | undefined; store: ScreensStore; canTurnOff: boolean }) {
  const [showAll, setShowAll] = useState(false);
  const { name } = monitor;
  if (!monitor.enabled || !monitor.mode) {
    return (
      <Group testID={`display:${name}`}>
        <Heading monitor={monitor} />
        <Row label="This display is off" detail="It stays plugged in; its windows are on the other screens.">
          <Button testID={`display-on:${name}`} label="Turn On" onPress={() => void store.setEnabled(name, true)} />
        </Row>
      </Group>
    );
  }
  const mode = monitor.mode;
  const here = { width: mode.width, height: mode.height };
  const every = sizesOf(monitor.modes);
  const common = commonSizes(monitor.modes, here);
  const sizes = showAll || common.length >= every.length ? every : common;
  const rates = ratesOf(monitor.modes, here);
  const choices = screen ? scaleChoices(screen).map((scale) => ({ value: scale, label: scaleLabel(scale) })) : [];
  const current = screen ? (choices.find((choice) => isCurrentScale(screen, choice.value))?.value ?? screen.scale) : monitor.scale;
  const looks = screen ? logicalSize(screen, screen.scale) : null;
  return (
    <Group testID={`display:${name}`}>
      <Heading monitor={monitor} />
      {every.length > 1 && (
        <Row stack label="Resolution" detail={`${sizeLabel(here)} now`}>
          <Choices
            testID={`display-resolution:${name}`}
            options={sizes.map((size) => ({ value: sizeLabel(size), label: monitor.modes.some((offered) => offered.preferred && offered.width === size.width && offered.height === size.height) ? `${sizeLabel(size)} (native)` : sizeLabel(size) }))}
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
        </Row>
      )}
      {rates.length > 1 && (
        <Row stack label="Refresh rate">
          <Choices
            testID={`display-refresh:${name}`}
            options={rates.map((rate) => ({ value: rate, label: refreshLabel(rate) }))}
            value={rates.find((rate) => Math.abs(rate - mode.refreshMhz) <= 600) ?? mode.refreshMhz}
            onChange={(rate) => void store.setMode(name, { ...here, refreshMhz: rate })}
          />
        </Row>
      )}
      <Row stack label="Rotation">
        <Choices
          testID={`display-rotation:${name}`}
          options={ROTATIONS.map((rotation) => ({ value: rotation, label: ROTATION_LABELS[rotation] }))}
          value={monitor.rotation}
          onChange={(rotation) => void store.setRotation(name, rotation)}
        />
      </Row>
      {screen && (
        <Row stack label="Scale" detail={looks ? `Looks like ${looks.width} × ${looks.height}` : undefined}>
          <Choices testID={`display-scale:${name}`} options={choices} value={current} onChange={(scale) => void store.setScale(name, scale)} />
        </Row>
      )}
      <Row label="Main display" detail={monitor.primary ? "The menu bar and Dock are here." : "Put the menu bar and Dock on this screen."}>
        {!monitor.primary && <Button testID={`display-main:${name}`} label="Use as Main Display" onPress={() => void store.setPrimary(name)} />}
      </Row>
      {canTurnOff && (
        <Row label="Turn off this display" detail="Its windows move to the other screens.">
          <Button testID={`display-off:${name}`} label="Turn Off" onPress={() => void store.setEnabled(name, false)} />
        </Row>
      )}
    </Group>
  );
}

export function DisplaysPane({ screens, settings, flags }: { screens: ScreensStore; settings: SettingsStore; flags: FlagsStore }) {
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
        <ScreenCard key={monitor.name} monitor={monitor} screen={state.screens.find((screen) => screen.name === monitor.name)} store={screens} canTurnOff={on.length > 1} />
      ))}
      {state.error !== null && (
        <View testID="displays-error" style={{ flexShrink: 0 }}>
          <Text style={{ fontSize: 11, color: colors.critical }}>{`Could not change the display: ${state.error}`}</Text>
        </View>
      )}
      <Caption>Windows move with the screen when its scale changes. The choice is kept for the next login. A new resolution or rotation goes back by itself unless you keep it.</Caption>
      <NightShiftSection settings={settings} flags={flags} />
    </Page>
  );
}
