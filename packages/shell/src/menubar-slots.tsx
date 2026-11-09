/**
 * The menu bar's own status items as slots of its status side
 * (menubar-status.tsx): the battery, the network, Sound, Do Not Disturb's
 * moon, Control Center (the area's pill is pressed while it is open) and
 * the clock. Sound, then the network, then the moon may go into "…" after
 * the extras (menubar-fit.ts); the battery, Control Center and the clock
 * never do.
 */

import type { Palette } from "@dashi/ui";
import { type Bounds, Svg, Text, View } from "@mirinjs/metal";
import { MOON } from "./control-center/glyphs.ts";
import { batteryGlyph, CONTROL_CENTER, networkGlyph, speakerGlyph } from "./glyphs.ts";
import { GOES } from "./menubar-fit.ts";
import { StatusItem, type StatusSlot } from "./menubar-status.tsx";
import type { Popover } from "./menus/controller.ts";
import type { SystemSnapshot } from "./system/store.ts";

export interface SystemSlotsInput extends Pick<SystemSnapshot, "battery" | "network" | "volume"> {
  /** settings.json `menuBar.batteryPercent`. */
  batteryPercent: boolean;
  /** settings.json `menuBar.sound`. */
  sound: boolean;
  dnd: boolean;
  /** The popover this bar has open, if any. */
  popover: Popover | null;
  clock: string;
  colors: Palette;
  on: { battery: (bounds?: Bounds) => void; controlCenter: () => void; wifi: () => void; clock: () => void };
  /** The Metal host takes accessibility props: each item is named. */
  accessible?: boolean;
}

/** What a screen reader says for the network item. */
export function networkLabel(network: NonNullable<SystemSnapshot["network"]>): string {
  return network.kind === "wired" ? "Ethernet" : network.kind === "wifi" ? "Wi-Fi" : "Network";
}

export function systemSlots({
  battery,
  network,
  volume,
  batteryPercent,
  sound,
  dnd,
  popover,
  clock,
  colors,
  on,
  accessible = false,
}: SystemSlotsInput): StatusSlot[] {
  const batteryLow = battery?.state === "discharging" && battery.percent <= 10;
  const named = (label: string) => (accessible ? { label } : {});
  const batteryLabel = battery ? `Battery ${battery.percent}%${battery.state === "charging" ? ", charging" : ""}` : "Battery";
  const networkName = network ? networkLabel(network) : "Network";
  const clockLabel = `Notification Center, ${clock}`;
  const toCenter = { kind: "panel" as const, run: () => on.controlCenter() };
  return [
    ...(battery
      ? [
          {
            key: "battery",
            goes: null,
            inArea: true,
            label: batteryLabel,
            open: { kind: "panel" as const, run: (bounds: Bounds | null) => on.battery(bounds ?? undefined) },
            node: (
              <StatusItem testID="status-battery" onPress={on.battery} open={popover?.kind === "battery" && popover.right !== null} {...named(batteryLabel)}>
                {batteryPercent && (
                  <View testID="status-battery-percent" style={{ marginRight: 5 }}>
                    <Text style={{ fontSize: 12, color: batteryLow ? colors.batteryLow : colors.text }}>{`${battery.percent}%`}</Text>
                  </View>
                )}
                <Svg
                  markup={batteryGlyph(battery.percent, battery.state === "charging" ? true : battery.state === "discharging" ? false : "plugged")}
                  width={24}
                  height={12}
                  color={batteryLow ? colors.batteryLow : colors.text}
                />
              </StatusItem>
            ),
          },
        ]
      : []),
    ...(network
      ? [
          {
            key: "network",
            goes: GOES.network,
            inArea: true,
            label: networkName,
            open: { kind: "panel" as const, run: () => (network.kind === "wired" ? on.controlCenter() : on.wifi()) },
            node: (
              // The network glyph opens Control Center on its Wi-Fi page; a wired connection has none.
              <StatusItem testID="status-network" onPress={network.kind === "wired" ? on.controlCenter : on.wifi} {...named(networkName)}>
                <Svg markup={networkGlyph(network)} size={15} color={colors.text} />
              </StatusItem>
            ),
          },
        ]
      : []),
    ...(volume && sound
      ? [
          {
            key: "sound",
            goes: GOES.sound,
            inArea: true,
            label: "Sound",
            open: toCenter,
            node: (
              <StatusItem testID="status-volume" onPress={on.controlCenter} {...named("Sound")}>
                <Svg markup={speakerGlyph(volume.level, volume.muted)} size={15} color={colors.text} />
              </StatusItem>
            ),
          },
        ]
      : []),
    ...(dnd
      ? [
          {
            key: "dnd",
            goes: GOES.dnd,
            inArea: true,
            label: "Do Not Disturb",
            open: toCenter,
            node: (
              <StatusItem testID="status-dnd" onPress={on.controlCenter} {...named("Do Not Disturb")}>
                <Svg markup={MOON} size={15} color={colors.text} />
              </StatusItem>
            ),
          },
        ]
      : []),
    {
      key: "control-center",
      goes: null,
      inArea: true,
      label: "Control Center",
      open: toCenter,
      node: (
        <StatusItem testID="status-control-center" onPress={on.controlCenter} {...named("Control Center")}>
          <Svg markup={CONTROL_CENTER} size={15} color={colors.text} />
        </StatusItem>
      ),
    },
    {
      key: "clock",
      goes: null,
      label: clockLabel,
      open: { kind: "panel", run: () => on.clock() },
      node: (
        <View
          testID="clock"
          onPress={on.clock}
          {...(accessible ? { accessibilityRole: "button" as const, accessibilityLabel: clockLabel } : {})}
          style={{
            justifyContent: "center",
            height: 22,
            paddingLeft: 8,
            paddingRight: 8,
            borderRadius: 5,
            backgroundColor: popover?.kind === "notification-center" ? colors.switcherSelection : "#00000000",
          }}
        >
          <Text numberOfLines={1} style={{ fontSize: 13, color: colors.text }}>
            {clock}
          </Text>
        </View>
      ),
    },
  ];
}
