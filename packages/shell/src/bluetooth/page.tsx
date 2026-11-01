/**
 * Control Center's Bluetooth page, the way macOS lays it out: a back arrow,
 * the power switch, and one card with "My Devices" (a round icon that is lit
 * while connected, the name, "Connected" or "Not Connected", the battery
 * when the device says), then "Nearby Devices" with a quiet "Searching…"
 * while the page looks for them. A click connects, disconnects, or pairs.
 * The "…" on a device of yours opens "Forget This Device", which asks once
 * more before it unpairs.
 */

import { Svg, Text, View } from "@mirinjs/metal";
import { useEffect, useRef, useState } from "react";
import { CHEVRON_LEFT } from "../control-center/glyphs.ts";
import { batteryGlyph } from "../glyphs.ts";
import { Button } from "../menus/sheets.tsx";
import { useColors } from "@dashi/ui";
import { Switch } from "../wifi/switch.tsx";
import { failureLine } from "./failures.ts";
import { deviceGlyph } from "./glyphs.ts";
import { type Busy, type BluetoothState, type BluetoothStore, useBluetooth } from "./store.ts";
import type { BluetoothDevice } from "./types.ts";

/** The card shows this many pixels of rows, then scrolls. */
const LIST_HEIGHT = 380;

const BUSY_TEXT: Record<Busy, string> = {
  connecting: "Connecting…",
  disconnecting: "Disconnecting…",
  pairing: "Pairing…",
  forgetting: "Forgetting…",
};

function Caption({ children, trailing }: { children: string; trailing?: { text: string; testID: string; onPress?: () => void } }) {
  const colors = useColors();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", paddingLeft: 8, paddingRight: 8, paddingTop: 6, paddingBottom: 2 }}>
      <Text style={{ fontSize: 11, fontWeight: "semibold", color: colors.textMuted }}>{children}</Text>
      {trailing && (
        <View testID={trailing.testID} onPress={trailing.onPress} style={{ marginLeft: "auto" }}>
          <Text style={{ fontSize: 11, color: trailing.onPress ? colors.selection : colors.textMuted }}>{trailing.text}</Text>
        </View>
      )}
    </View>
  );
}

function Note({ children }: { children: string }) {
  const colors = useColors();
  return (
    <View testID="bt-note" style={{ height: 56, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ fontSize: 12, color: colors.textMuted }}>{children}</Text>
    </View>
  );
}

/** The round icon: lit with the accent while the device is connected. */
function DeviceIcon({ device }: { device: BluetoothDevice }) {
  const colors = useColors();
  return (
    <View
      style={{ width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: device.connected ? colors.selection : colors.track }}
    >
      <Svg markup={deviceGlyph(device.kind)} size={14} color={device.connected ? "#ffffff" : colors.text} />
    </View>
  );
}

function Row({
  device,
  busy,
  idle,
  onChoose,
  onMore,
}: {
  device: BluetoothDevice;
  busy: Busy | undefined;
  /** Nothing is being done to this device, so a press does something. */
  idle: boolean;
  onChoose: (device: BluetoothDevice) => void;
  /** Mine only: the "…" that opens Forget. */
  onMore?: () => void;
}) {
  const colors = useColors();
  const mine = device.paired || device.connected;
  const detail = busy ? BUSY_TEXT[busy] : mine ? (device.connected ? "Connected" : "Not Connected") : null;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", borderRadius: 8 }}>
      <View
        testID={`bt-row:${device.name}`}
        onPress={idle ? () => onChoose(device) : undefined}
        style={{
          flex: 1,
          minWidth: 0,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          height: 38,
          paddingLeft: 6,
          paddingRight: 6,
          borderRadius: 8,
          hoverBackgroundColor: colors.button,
        }}
      >
        <DeviceIcon device={device} />
        <View style={{ flex: 1, minWidth: 0, flexDirection: "column", overflow: "hidden" }}>
          <Text numberOfLines={1} style={{ fontSize: 13, color: colors.text }}>
            {device.name}
          </Text>
          {detail !== null && (
            <View testID={`bt-detail:${device.name}`}>
              <Text numberOfLines={1} style={{ fontSize: 11, color: colors.textMuted }}>
                {detail}
              </Text>
            </View>
          )}
        </View>
        {device.battery !== null && !busy && (
          <View testID={`bt-battery:${device.name}`} style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
            <Svg markup={batteryGlyph(device.battery, false)} width={18} height={9} color={colors.textMuted} />
            <Text style={{ fontSize: 11, color: colors.textMuted }}>{`${device.battery}%`}</Text>
          </View>
        )}
      </View>
      {onMore && (
        <View
          testID={`bt-more:${device.name}`}
          onPress={onMore}
          style={{ width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center", hoverBackgroundColor: colors.button }}
        >
          <Text style={{ fontSize: 13, fontWeight: "bold", color: colors.textMuted }}>⋯</Text>
        </View>
      )}
    </View>
  );
}

/** What opens under a device of yours: Forget This Device, then an are-you-sure. */
function ForgetStrip({ device, confirming, onAsk, onCancel, onForget }: { device: BluetoothDevice; confirming: boolean; onAsk: () => void; onCancel: () => void; onForget: () => void }) {
  const colors = useColors();
  if (!confirming) {
    return (
      <View testID={`bt-forget:${device.name}`} onPress={onAsk} style={{ height: 28, justifyContent: "center", paddingLeft: 40, borderRadius: 8, hoverBackgroundColor: colors.button }}>
        <Text style={{ fontSize: 12, color: colors.critical }}>Forget This Device</Text>
      </View>
    );
  }
  return (
    <View style={{ flexDirection: "column", gap: 6, paddingLeft: 40, paddingRight: 6, paddingTop: 2, paddingBottom: 6 }}>
      <View testID="bt-forget-question">
        <Text style={{ fontSize: 12, color: colors.text }}>{`Forget “${device.name}”? You will need to pair it again.`}</Text>
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Button testID="bt-forget-cancel" label="Cancel" onPress={onCancel} />
        <Button testID="bt-forget-confirm" label="Forget" primary onPress={onForget} />
      </View>
    </View>
  );
}

function List({ state, store }: { state: BluetoothState; store: BluetoothStore }) {
  /** The device whose "…" is open, and whether it is at the are-you-sure. */
  const [more, setMore] = useState<{ path: string; confirming: boolean } | null>(null);
  const idle = (device: BluetoothDevice) => state.busy[device.path] === undefined;
  const choose = (device: BluetoothDevice) => void store.choose(device);
  const searching = state.discovering || state.available === null;
  return (
    <View style={{ flexDirection: "column", maxHeight: LIST_HEIGHT, overflow: "scroll" }}>
      {state.mine.length > 0 && <Caption>My Devices</Caption>}
      {state.mine.map((device) => (
        <View key={device.path} style={{ flexDirection: "column" }}>
          <Row
            device={device}
            busy={state.busy[device.path]}
            idle={idle(device)}
            onChoose={choose}
            onMore={() => setMore(more?.path === device.path ? null : { path: device.path, confirming: false })}
          />
          {more?.path === device.path && (
            <ForgetStrip
              device={device}
              confirming={more.confirming}
              onAsk={() => setMore({ path: device.path, confirming: true })}
              onCancel={() => setMore(null)}
              onForget={() => {
                setMore(null);
                void store.forget(device);
              }}
            />
          )}
        </View>
      ))}
      <Caption
        trailing={
          searching
            ? { text: "Searching…", testID: "bt-searching" }
            : { text: "Search Again", testID: "bt-search-again", onPress: () => store.searchAgain() }
        }
      >
        Nearby Devices
      </Caption>
      {state.nearby.map((device) => (
        <Row key={device.path} device={device} busy={state.busy[device.path]} idle={idle(device)} onChoose={choose} />
      ))}
      {state.nearby.length === 0 && !searching && <Note>No devices found</Note>}
    </View>
  );
}

export interface BluetoothPageProps {
  bluetooth: BluetoothStore;
  /** The power switch; null when it cannot be read. */
  radio: boolean | null;
  onRadio: (on: boolean) => void;
  onBack: () => void;
}

export function BluetoothPage({ bluetooth, radio, onRadio, onBack }: BluetoothPageProps) {
  const colors = useColors();
  const state = useBluetooth(bluetooth);
  useEffect(() => {
    bluetooth.open();
    return () => bluetooth.close();
  }, [bluetooth]);
  // The switch moving is the moment to look again; the first render is the open's.
  const before = useRef(radio);
  useEffect(() => {
    if (radio !== before.current) void bluetooth.refresh();
    before.current = radio;
  }, [radio, bluetooth]);

  const on = radio !== false;
  const { failure } = state;
  return (
    <>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4, height: 28 }}>
        <View
          testID="bt-back"
          onPress={onBack}
          style={{ width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", hoverBackgroundColor: colors.button }}
        >
          <Svg markup={CHEVRON_LEFT} size={14} color={colors.text} />
        </View>
        <Text style={{ fontSize: 14, fontWeight: "bold", color: colors.text }}>Bluetooth</Text>
        <View style={{ marginLeft: "auto" }}>
          <Switch testID="bt-switch" on={on} onChange={onRadio} />
        </View>
      </View>
      <View testID="bt-list" style={{ flexDirection: "column", padding: 4, borderRadius: 12, backgroundColor: colors.tile }}>
        {!on ? (
          <Note>Bluetooth is off</Note>
        ) : state.available === false ? (
          <Note>Bluetooth isn't available on this computer</Note>
        ) : (
          <List state={state} store={bluetooth} />
        )}
      </View>
      {failure && on && (
        <View testID="bt-failure" style={{ paddingLeft: 6 }}>
          <Text style={{ fontSize: 11, color: colors.critical }}>{`“${failure.name}”: ${failureLine(failure.action, failure.reason, failure.paired)}`}</Text>
        </View>
      )}
    </>
  );
}
