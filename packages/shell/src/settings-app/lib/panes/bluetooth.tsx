/**
 * Bluetooth: the power switch, My Devices (connect, disconnect, or forget;
 * the battery when BlueZ reports it), and Nearby Devices, which can be paired.
 * It is Control Center's Bluetooth store, so the pairing sheet (a code to
 * compare, a PIN to type) is the one used there. The page looks for devices
 * while it is open and stops when it closes.
 */

import { Svg, Text, View } from "@mirinjs/metal";
import { useEffect, useState } from "react";
import { failureLine } from "../../../bluetooth/failures.ts";
import { deviceGlyph } from "../../../bluetooth/glyphs.ts";
import { type BluetoothState, useBluetooth } from "../../../bluetooth/store.ts";
import type { BluetoothDevice } from "../../../bluetooth/types.ts";
import { useDevices } from "../../../control-center/index.ts";
import { batteryGlyph } from "../../../glyphs.ts";
import { useColors } from "../../colors.ts";
import type { PaneServices } from "../../services.ts";
import { Caption, Group, Note, Page, Switch } from "../../ui.tsx";
import { Setting } from "../setting.tsx";
import { Failure, KindMark, ListRow, MiniButton } from "./parts.tsx";

const BUSY = { connecting: "Connecting…", disconnecting: "Disconnecting…", pairing: "Pairing…", forgetting: "Forgetting…" } as const;

function Battery({ percent, name }: { percent: number; name: string }) {
  const colors = useColors();
  return (
    <>
      <Svg markup={batteryGlyph(percent, false)} width={18} height={9} color={colors.textMuted} />
      <View testID={`bt-battery:${name}`}>
        <Text style={{ fontSize: 11, color: colors.textMuted }}>{`${percent}%`}</Text>
      </View>
    </>
  );
}

function MyDevice({
  device,
  state,
  confirming,
  onConfirm,
  services,
}: {
  device: BluetoothDevice;
  state: BluetoothState;
  confirming: boolean;
  onConfirm: (asking: boolean) => void;
  services: PaneServices;
}) {
  const { bluetooth } = services;
  const busy = state.busy[device.path];
  const detail = busy ? BUSY[busy] : device.connected ? "Connected" : "Not Connected";
  return (
    <ListRow testID={`bt-device:${device.name}`} name={device.name} detail={detail} bold={device.connected}>
      <KindMark glyph={deviceGlyph(device.kind)} />
      {device.battery !== null && !busy && <Battery percent={device.battery} name={device.name} />}
      {confirming ? (
        <>
          <MiniButton testID={`bt-forget-cancel:${device.name}`} label="Cancel" onPress={() => onConfirm(false)} />
          <MiniButton
            testID={`bt-forget-confirm:${device.name}`}
            label="Forget"
            tone="critical"
            onPress={() => {
              onConfirm(false);
              void bluetooth.forget(device);
            }}
          />
        </>
      ) : (
        <>
          <MiniButton
            testID={`bt-toggle:${device.name}`}
            label={device.connected ? "Disconnect" : "Connect"}
            disabled={busy !== undefined}
            onPress={() => void (device.connected ? bluetooth.disconnect(device) : bluetooth.connect(device))}
          />
          <MiniButton testID={`bt-forget:${device.name}`} label="Forget…" tone="critical" disabled={busy !== undefined} onPress={() => onConfirm(true)} />
        </>
      )}
    </ListRow>
  );
}

function Devices({ services }: { services: PaneServices }) {
  const { bluetooth } = services;
  const state = useBluetooth(bluetooth);
  const [asking, setAsking] = useState<string | null>(null);
  const searching = state.discovering || state.available === null;
  const { failure } = state;
  return (
    <>
      {state.mine.length > 0 && (
        <>
          <Caption above>My Devices</Caption>
          <Group testID="bt-mine">
            {state.mine.map((device) => (
              <MyDevice
                key={device.path}
                device={device}
                state={state}
                services={services}
                confirming={asking === device.path}
                onConfirm={(on) => setAsking(on ? device.path : null)}
              />
            ))}
          </Group>
        </>
      )}
      <Caption above>{searching ? "Nearby Devices — Searching…" : "Nearby Devices"}</Caption>
      <Group testID="bt-nearby">
        {state.nearby.map((device) => (
          <ListRow
            key={device.path}
            testID={`bt-nearby:${device.name}`}
            name={device.name}
            detail={state.busy[device.path] ? BUSY[state.busy[device.path] as keyof typeof BUSY] : undefined}
          >
            <KindMark glyph={deviceGlyph(device.kind)} />
            <MiniButton
              testID={`bt-pair:${device.name}`}
              label="Connect"
              tone="primary"
              disabled={state.busy[device.path] !== undefined}
              onPress={() => void bluetooth.pair(device)}
            />
          </ListRow>
        ))}
        {state.nearby.length === 0 && <Note testID="bt-none">{searching ? "Looking for devices…" : "No devices found."}</Note>}
      </Group>
      {!searching && (
        <Group>
          <Setting id="bluetooth/search-again">
            <MiniButton testID="bt-search-again" label="Search" onPress={() => bluetooth.searchAgain()} />
          </Setting>
        </Group>
      )}
      {failure && <Failure testID="bt-failure">{`“${failure.name}”: ${failureLine(failure.action, failure.reason, failure.paired)}`}</Failure>}
    </>
  );
}

export function BluetoothPane({ services }: { services: PaneServices }) {
  const { devices, bluetooth } = services;
  const radios = useDevices(devices);
  const state = useBluetooth(bluetooth);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    void devices.refresh().then(() => setLoaded(true));
    bluetooth.open();
    return () => bluetooth.close();
  }, [devices, bluetooth]);
  // The switch moving is the moment to look again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the radio switching is the moment to look again
  useEffect(() => {
    if (loaded) void bluetooth.refresh();
  }, [radios.bluetooth, loaded, bluetooth]);

  const on = radios.bluetooth !== false;
  // No adapter: BlueZ says so, or the radio cannot be read at all.
  const missing = state.available === false || (loaded && radios.bluetooth === null && state.available !== true);
  return (
    <Page title="Bluetooth">
      <Group testID="bt-power">
        <Setting id="bluetooth/bluetooth" detail={missing ? "No Bluetooth adapter" : on ? "On" : "Off"}>
          {!missing && <Switch testID="bt-radio" on={on} onChange={(next) => void devices.setBluetooth(next)} />}
        </Setting>
      </Group>
      {missing ? (
        <Group>
          <Note testID="bt-unavailable">Bluetooth isn't available on this computer.</Note>
        </Group>
      ) : on ? (
        <Devices services={services} />
      ) : (
        <Group>
          <Note testID="bt-off">Bluetooth is off. Turn it on to connect to devices.</Note>
        </Group>
      )}
    </Page>
  );
}
