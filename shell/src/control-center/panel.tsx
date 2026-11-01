/**
 * Control Center, macOS style: tiles for Wi-Fi, Bluetooth, Do Not Disturb,
 * and Dark Mode (on is the accent color), sliders for the display and the
 * sound, and a Lock Screen button. A tile for hardware the machine lacks is
 * not shown.
 */

import { Svg, Text, View } from "@mirinjs/metal";
import { type ReactElement, type ReactNode, useEffect } from "react";
import { BluetoothPage } from "../bluetooth/page.tsx";
import type { BluetoothStore } from "../bluetooth/store.ts";
import { KeyCatcher } from "../overlay.tsx";
import { ETHERNET, speakerGlyph, SUN, wifiGlyph } from "../glyphs.ts";
import { type SystemStore, useSystem } from "../system/store.ts";
import { useColors } from "../theme.ts";
import { SoundPage } from "../sound/page.tsx";
import type { SoundStore } from "../sound/store.ts";
import { WifiPage } from "../wifi/page.tsx";
import type { WifiStore } from "../wifi/store.ts";
import type { WifiNetwork } from "../wifi/types.ts";
import { type DeviceStore, useDevices } from "./devices.ts";
import { type FlagsStore, useFlags } from "./flags.ts";
import { BLUETOOTH, CHEVRON_RIGHT, CONTRAST, LOCK, MOON, SUNSET } from "./glyphs.ts";
import { Slider } from "./slider.tsx";

export const CONTROL_CENTER_PANEL = { width: 340, padding: 12, gap: 8 } as const;

const INNER = CONTROL_CENTER_PANEL.width - 2 * CONTROL_CENTER_PANEL.padding;
/** A slider card: its padding is 10 on each side. */
const SLIDER = INNER - 20;

/** What the panel shows: the tiles and sliders, or a tile's own page. */
export type ControlPage = "main" | "wifi" | "sound" | "bluetooth";

export interface ControlCenterProps {
  flags: FlagsStore;
  devices: DeviceStore;
  system: SystemStore;
  wifi: WifiStore;
  sound: SoundStore;
  bluetooth: BluetoothStore;
  page: ControlPage;
  onPage: (page: ControlPage) => void;
  /** A network was picked on the Wi-Fi page. */
  onJoin: (network: WifiNetwork) => void;
  onLock: () => void;
  onClose: () => void;
}

function Tile({
  glyph,
  label,
  detail,
  on,
  testID,
  onPress,
  onOpen,
}: {
  glyph: string;
  label: string;
  detail: string;
  on: boolean;
  testID: string;
  /** The switch: the whole tile, or just its circle when the tile also opens a page. */
  onPress: () => void;
  /** The tile has a page of its own: the label and the chevron open it. */
  onOpen?: () => void;
}) {
  const colors = useColors();
  const circle = (
    <View
      testID={onOpen ? `${testID}-switch` : undefined}
      onPress={onOpen ? onPress : undefined}
      style={{
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: on ? colors.selection : colors.track,
      }}
    >
      <Svg markup={glyph} size={17} color={on ? "#ffffff" : colors.text} />
    </View>
  );
  const labels = (
    <View style={{ flex: 1, flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
      <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: "semibold", color: colors.text }}>
        {label}
      </Text>
      <Text numberOfLines={1} style={{ fontSize: 11, color: colors.textMuted }}>
        {detail}
      </Text>
    </View>
  );
  return (
    <View
      testID={testID}
      onPress={onOpen ? undefined : onPress}
      style={{
        flex: 1,
        height: 56,
        flexDirection: "row",
        alignItems: "center",
        paddingLeft: 10,
        paddingRight: 6,
        borderRadius: 12,
        backgroundColor: colors.tile,
      }}
    >
      {onOpen ? (
        <>
          {circle}
          {/* A press on the circle toggles; one anywhere else on the tile opens the page. */}
          <View testID={`${testID}-open`} onPress={onOpen} style={{ flex: 1, height: 56, flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 8, minWidth: 0 }}>
            {labels}
            <Svg markup={CHEVRON_RIGHT} size={12} color={colors.textMuted} />
          </View>
        </>
      ) : (
        <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 }}>
          {circle}
          {labels}
        </View>
      )}
    </View>
  );
}

/** A card's title; with `onOpen` the title and a chevron open the card's page. */
function Card({ title, children, onOpen }: { title: string; children: ReactNode; onOpen?: () => void }) {
  const colors = useColors();
  const heading = <Text style={{ fontSize: 12, fontWeight: "semibold", color: colors.text }}>{title}</Text>;
  return (
    <View style={{ flexDirection: "column", gap: 6, padding: 10, borderRadius: 12, backgroundColor: colors.tile }}>
      {onOpen ? (
        <View testID={`cc-${title.toLowerCase()}-open`} onPress={onOpen} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          {heading}
          <View style={{ flex: 1 }} />
          <Svg markup={CHEVRON_RIGHT} size={12} color={colors.textMuted} />
        </View>
      ) : (
        heading
      )}
      {children}
    </View>
  );
}

/** Rows of two; a lone last tile takes its row. */
export function pairs<T>(items: readonly T[]): T[][] {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += 2) rows.push(items.slice(index, index + 2));
  return rows;
}

export function ControlCenterPanel({ flags, devices, system, wifi, sound, bluetooth: bluetoothStore, page, onPage, onJoin, onLock, onClose }: ControlCenterProps) {
  const colors = useColors();
  const { dnd, dark, night } = useFlags(flags);
  const { wifi: radio, bluetooth, brightness, volume } = useDevices(devices);
  const { network } = useSystem(system);

  useEffect(() => {
    void devices.refresh();
    void system.refresh("network");
  }, [devices, system]);

  const connected = network?.kind === "wifi" && network.ssid ? network.ssid : "Not Connected";
  const tiles = [
    radio !== null && (
      <Tile
        key="wifi"
        testID="cc-wifi"
        glyph={wifiGlyph(radio ? 3 : "offline")}
        label="Wi-Fi"
        detail={radio ? connected : "Off"}
        on={radio}
        onPress={() => void devices.setWifi(!radio)}
        onOpen={() => onPage("wifi")}
      />
    ),
    // No Wi-Fi hardware: the wired connection is what there is to show.
    radio === null && network?.kind === "wired" && (
      <Tile key="ethernet" testID="cc-ethernet" glyph={ETHERNET} label="Ethernet" detail="Connected" on onPress={() => {}} />
    ),
    bluetooth !== null && (
      <Tile
        key="bluetooth"
        testID="cc-bluetooth"
        glyph={BLUETOOTH}
        label="Bluetooth"
        detail={bluetooth ? "On" : "Off"}
        on={bluetooth}
        onPress={() => void devices.setBluetooth(!bluetooth)}
        onOpen={() => onPage("bluetooth")}
      />
    ),
    <Tile key="dnd" testID="cc-dnd" glyph={MOON} label="Do Not Disturb" detail={dnd ? "On" : "Off"} on={dnd} onPress={() => flags.toggle("dnd")} />,
    <Tile key="dark" testID="cc-dark" glyph={CONTRAST} label="Dark Mode" detail={dark ? "On" : "Off"} on={dark} onPress={() => flags.toggle("dark")} />,
    <Tile key="night" testID="cc-night" glyph={SUNSET} label="Night Shift" detail={night ? "On" : "Off"} on={night} onPress={() => flags.toggle("night")} />,
  ].filter((tile): tile is ReactElement => tile !== false);

  return (
    <>
      <KeyCatcher onKey={(key) => key === "Escape" && onClose()} />
      <View
        occlude
        testID="control-center"
        style={{
          position: "absolute",
          right: 8,
          top: 2,
          width: CONTROL_CENTER_PANEL.width,
          flexDirection: "column",
          gap: CONTROL_CENTER_PANEL.gap,
          padding: CONTROL_CENTER_PANEL.padding,
          borderRadius: 18,
          backgroundColor: colors.menu,
          borderWidth: 1,
          borderColor: colors.dockBorder,
          shadow: "xl",
        }}
      >
        {page === "wifi" ? (
          <WifiPage wifi={wifi} radio={radio} onRadio={(on) => void devices.setWifi(on)} onChoose={onJoin} onBack={() => onPage("main")} />
        ) : page === "sound" ? (
          <SoundPage
            sound={sound}
            volume={volume}
            onVolume={(level) => devices.setVolumeLevel(level)}
            sliderWidth={SLIDER}
            onBack={() => onPage("main")}
          />
        ) : page === "bluetooth" ? (
          <BluetoothPage bluetooth={bluetoothStore} radio={bluetooth} onRadio={(on) => void devices.setBluetooth(on)} onBack={() => onPage("main")} />
        ) : (
          <>
            {pairs(tiles).map((row, index) => (
              // The rows never reorder.
              <View key={index} style={{ flexDirection: "row", gap: CONTROL_CENTER_PANEL.gap }}>
                {row}
              </View>
            ))}
            {brightness !== null && (
              <Card title="Display">
                <Slider testID="cc-brightness" width={SLIDER} value={brightness} glyph={SUN} onChange={(value) => devices.setBrightnessLevel(value)} />
              </Card>
            )}
            {volume !== null && (
              <Card title="Sound" onOpen={() => onPage("sound")}>
                <Slider
                  testID="cc-volume"
                  width={SLIDER}
                  value={volume.muted ? 0 : volume.level}
                  glyph={speakerGlyph(volume.level, volume.muted)}
                  onChange={(value) => devices.setVolumeLevel(value)}
                />
              </Card>
            )}
            <View
              testID="cc-lock"
              onPress={onLock}
              style={{ flexDirection: "row", alignItems: "center", gap: 10, height: 40, paddingLeft: 12, borderRadius: 12, backgroundColor: colors.tile }}
            >
              <Svg markup={LOCK} size={15} color={colors.text} />
              <Text style={{ fontSize: 13, fontWeight: "semibold", color: colors.text }}>Lock Screen</Text>
            </View>
          </>
        )}
      </View>
    </>
  );
}
