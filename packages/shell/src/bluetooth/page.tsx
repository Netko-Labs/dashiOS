/**
 * Control Center's Bluetooth page, grown out of the Bluetooth tile
 * (control-center/page-parts.tsx): the tile is its header (back, the device
 * connected, the power switch), then "My Devices" (a connected one is green,
 * as a tile that is on; "Not Connected" otherwise; the battery when the
 * device says), then "Nearby Devices" with a quiet "Searching…" while the
 * page looks for them. A press connects, disconnects, or pairs. The "⋯" on a
 * device of yours opens "Forget This Device", which asks once more before it
 * unpairs.
 */

import { Svg, Text, View } from "@mirinjs/metal";
import { useEffect, useRef, useState } from "react";
import { PageBody, PageHeader, PageNote, PageRow, PageSection } from "../control-center/page-parts.tsx";
import { batteryGlyph } from "../glyphs.ts";
import { Button } from "../menus/sheets.tsx";
import { useControlColors } from "../shared/controls/palette.ts";
import { failureLine } from "./failures.ts";
import { deviceGlyph } from "./glyphs.ts";
import { type BluetoothState, type BluetoothStore, type Busy, useBluetooth } from "./store.ts";
import type { BluetoothDevice } from "./types.ts";

/** The list shows this many points of rows, then scrolls. */
const LIST_HEIGHT = 380;

const BUSY_TEXT: Record<Busy, string> = {
  connecting: "Connecting…",
  disconnecting: "Disconnecting…",
  pairing: "Pairing…",
  forgetting: "Forgetting…",
};

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
  /** Mine only: the "⋯" that opens Forget. */
  onMore?: () => void;
}) {
  const colors = useControlColors();
  const mine = device.paired || device.connected;
  const detail = busy ? BUSY_TEXT[busy] : mine ? (device.connected ? "Connected" : "Not Connected") : null;
  const ink = device.connected ? colors.onInk : colors.offInk;
  return (
    <PageRow
      testID={`bt-row:${device.name}`}
      label={device.name}
      glyph={deviceGlyph(device.kind)}
      detail={detail}
      checked={device.connected}
      {...(idle ? { onPress: () => onChoose(device) } : {})}
      trailing={
        <>
          {device.battery !== null && !busy && (
            <View testID={`bt-battery:${device.name}`} style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
              <Svg markup={batteryGlyph(device.battery, false)} width={18} height={9} color={ink} />
              <Text style={{ fontSize: 11, color: ink }}>{`${device.battery}%`}</Text>
            </View>
          )}
          {onMore && (
            <View
              testID={`bt-more:${device.name}`}
              onPress={onMore}
              accessibilityRole="button"
              accessibilityLabel="More"
              style={{ width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" }}
            >
              <Text style={{ fontSize: 13, fontWeight: "bold", color: ink }}>⋯</Text>
            </View>
          )}
        </>
      }
    />
  );
}

/** What opens under a device of yours: Forget This Device, then an are-you-sure. */
function ForgetStrip({
  device,
  confirming,
  onAsk,
  onCancel,
  onForget,
}: {
  device: BluetoothDevice;
  confirming: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onForget: () => void;
}) {
  const colors = useControlColors();
  if (!confirming) return <PageRow testID={`bt-forget:${device.name}`} label="Forget This Device" onPress={onAsk} />;
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
  const colors = useControlColors();
  /** The device whose "…" is open, and whether it is at the are-you-sure. */
  const [more, setMore] = useState<{ path: string; confirming: boolean } | null>(null);
  const idle = (device: BluetoothDevice) => state.busy[device.path] === undefined;
  const choose = (device: BluetoothDevice) => void store.choose(device);
  const searching = state.discovering || state.available === null;
  return (
    <View style={{ flexDirection: "column", gap: 6, maxHeight: LIST_HEIGHT, overflow: "scroll" }}>
      {state.mine.length > 0 && <PageSection>My Devices</PageSection>}
      {state.mine.map((device) => (
        <View key={device.path} style={{ flexDirection: "column", gap: 6 }}>
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
      <PageSection
        trailing={
          searching ? (
            <View testID="bt-searching">
              <Text style={{ fontSize: 11, color: colors.muted }}>Searching…</Text>
            </View>
          ) : (
            <View testID="bt-search-again" onPress={() => store.searchAgain()}>
              <Text style={{ fontSize: 11, fontWeight: "semibold", color: colors.text }}>Search Again</Text>
            </View>
          )
        }
      >
        Nearby Devices
      </PageSection>
      {state.nearby.map((device) => (
        <Row key={device.path} device={device} busy={state.busy[device.path]} idle={idle(device)} onChoose={choose} />
      ))}
      {state.nearby.length === 0 && !searching && <PageNote testID="bt-note">No devices found</PageNote>}
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
  const connected = state.mine.find((device) => device.connected);
  return (
    <>
      <PageHeader
        testID="bt-header"
        title="Bluetooth"
        detail={!on ? "Off" : (connected?.name ?? "On")}
        on={on}
        onBack={onBack}
        toggle={{ on, onChange: onRadio }}
      />
      <PageBody testID="bt-list">
        {!on ? (
          <PageNote testID="bt-note">Bluetooth is off</PageNote>
        ) : state.available === false ? (
          <PageNote testID="bt-note">Bluetooth isn't available on this computer</PageNote>
        ) : (
          <List state={state} store={bluetooth} />
        )}
        {failure && on && (
          <PageNote testID="bt-failure" tone="critical">{`“${failure.name}”: ${failureLine(failure.action, failure.reason, failure.paired)}`}</PageNote>
        )}
      </PageBody>
    </>
  );
}
