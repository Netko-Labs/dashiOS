/**
 * Bluetooth: the power switch, My Devices (connect, disconnect, or forget;
 * the battery when BlueZ reports it), and Nearby Devices, which can be paired.
 * It is Control Center's Bluetooth store, so the pairing sheet (a code to
 * compare, a PIN to type) is the one used there. The page looks for devices
 * while it is open and stops when it closes.
 */

import { Loading, TYPE } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import { useEffect, useState } from "react";
import { failureLine } from "../../../bluetooth/failures.ts";
import { deviceGlyph } from "../../../bluetooth/glyphs.ts";
import { useBluetooth } from "../../../bluetooth/store.ts";
import type { BluetoothDevice, BluetoothState } from "../../../bluetooth/types.ts";
import { useDevices } from "../../../control-center/index.ts";
import { batteryGlyph } from "../../../glyphs.ts";
import { Caption, Group, Note } from "../../../shared/cards/index.ts";
import { useColors } from "../../colors.ts";
import type { PaneServices } from "../../services.ts";
import { Page, Switch } from "../../ui.tsx";
import { Setting } from "../setting.tsx";
import { ConfirmDelete, Failure, KindMark, ListRow, MiniButton } from "./parts.tsx";

const BUSY = { connecting: "Connecting…", disconnecting: "Disconnecting…", pairing: "Pairing…", forgetting: "Forgetting…" } as const;

function Battery({ percent, name }: { percent: number; name: string }) {
  const colors = useColors();
  return (
    <>
      <Svg markup={batteryGlyph(percent, false)} width={18} height={9} color={colors.textMuted} />
      <View testID={`bt-battery:${name}`}>
        <Text style={{ fontSize: TYPE.caption.size, color: colors.textMuted }}>{`${percent}%`}</Text>
      </View>
    </>
  );
}

function MyDevice({ device, state, services }: { device: BluetoothDevice; state: BluetoothState; services: PaneServices }) {
  const { bluetooth } = services;
  const busy = state.busy[device.path];
  const [asking, setAsking] = useState(false);
  const detail = busy ? BUSY[busy] : device.connected ? "Connected" : "Not connected";
  return (
    <ListRow testID={`bt-device:${device.name}`} name={device.name} detail={detail}>
      <KindMark glyph={deviceGlyph(device.kind)} />
      {device.battery !== null && !busy && <Battery percent={device.battery} name={device.name} />}
      {!asking && (
        <MiniButton
          testID={`bt-toggle:${device.name}`}
          label={device.connected ? "Disconnect" : "Connect"}
          disabled={busy !== undefined}
          onPress={() => void (device.connected ? bluetooth.disconnect(device) : bluetooth.connect(device))}
        />
      )}
      <ConfirmDelete
        testID={`bt-forget:${device.name}`}
        verb="Forget"
        disabled={busy !== undefined}
        onAsking={setAsking}
        onDelete={() => void bluetooth.forget(device)}
      />
    </ListRow>
  );
}

function Devices({ services }: { services: PaneServices }) {
  const { bluetooth } = services;
  const state = useBluetooth(bluetooth);
  const searching = state.discovering || state.available === null;
  const { failure } = state;
  return (
    <>
      {state.mine.length > 0 && (
        <>
          <Caption above>My devices</Caption>
          <Group testID="bt-mine">
            {state.mine.map((device) => (
              <MyDevice key={device.path} device={device} state={state} services={services} />
            ))}
          </Group>
        </>
      )}
      <Caption above>Nearby devices</Caption>
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
        {state.nearby.length === 0 &&
          (searching ? (
            <Loading testID="bt-none" label="Looking for devices…" />
          ) : (
            <Note testID="bt-none">No devices found. Put the device in pairing mode, then search again.</Note>
          ))}
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
  // Each fact once (SE-7, SE-17): a missing adapter or the radio being off is the row's own line, no card under it.
  const detail = missing ? "This computer has no Bluetooth adapter." : on ? "On" : "Off. Turn it on to connect to devices.";
  return (
    <Page title="Bluetooth">
      <Group testID="bt-power">
        <Setting id="bluetooth/bluetooth" detail={detail}>
          {!missing && <Switch testID="bt-radio" on={on} onChange={(next) => void devices.setBluetooth(next)} />}
        </Setting>
      </Group>
      {!missing && on && <Devices services={services} />}
    </Page>
  );
}
