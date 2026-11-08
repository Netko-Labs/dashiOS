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
}

export function systemSlots({ battery, network, volume, batteryPercent, sound, dnd, popover, clock, colors, on }: SystemSlotsInput): StatusSlot[] {
  const batteryLow = battery?.state === "discharging" && battery.percent <= 10;
  return [
    ...(battery
      ? [
          {
            key: "battery",
            goes: null,
            inArea: true,
            node: (
              <StatusItem testID="status-battery" onPress={on.battery} open={popover?.kind === "battery" && popover.right !== null}>
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
            node: (
              // The network glyph opens Control Center on its Wi-Fi page; a wired connection has none.
              <StatusItem testID="status-network" onPress={network.kind === "wired" ? on.controlCenter : on.wifi}>
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
            node: (
              <StatusItem testID="status-volume" onPress={on.controlCenter}>
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
            node: (
              <StatusItem testID="status-dnd" onPress={on.controlCenter}>
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
      node: (
        <StatusItem testID="status-control-center" onPress={on.controlCenter}>
          <Svg markup={CONTROL_CENTER} size={15} color={colors.text} />
        </StatusItem>
      ),
    },
    {
      key: "clock",
      goes: null,
      node: (
        <View
          testID="clock"
          onPress={on.clock}
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
