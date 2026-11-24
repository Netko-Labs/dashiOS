/**
 * Control Center's Bluetooth page, grown out of the Bluetooth tile
 * (control-center/page-parts.tsx): the tile is its header (back, the device
 * connected, the power switch), then "My devices" (a connected one is green,
 * as a tile that is on; "Not connected" otherwise; the battery when the
 * device says), then "Nearby devices" with a quiet "Searching…" while the
 * page looks for them. A press connects, disconnects, or pairs. The "⋯" on a
 * device of yours opens "Forget this device", which asks once more before it
 * unpairs.
 */

import { Button, MORE, SPACE, ToolbarButton, TYPE, useControlColors } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import { useEffect, useRef, useState } from "react";
import { PageBody, PageHeader, PageNote, PageRow, PageSection } from "../control-center/page-parts.tsx";
import { batteryGlyph } from "../glyphs.ts";
import { failureLine } from "./failures.ts";
import { deviceGlyph } from "./glyphs.ts";
import { type BluetoothStore, useBluetooth } from "./store.ts";
import type { BluetoothDevice, BluetoothState, Busy } from "./types.ts";

/** The question under a row starts under its name, clear of its glyph. */
const FORGET_INSET = 40;

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
  moreOpen = false,
}: {
  device: BluetoothDevice;
  busy: Busy | undefined;
  /** Nothing is being done to this device, so a press does something. */
  idle: boolean;
  onChoose: (device: BluetoothDevice) => void;
  /** Mine only: "…" (the `MORE` glyph), which opens Forget under the row. */
  onMore?: () => void;
  /** Forget is open under the row: "…" stays washed. */
  moreOpen?: boolean;
}) {
  const colors = useControlColors();
  const mine = device.paired || device.connected;
  const detail = busy ? BUSY_TEXT[busy] : mine ? (device.connected ? "Connected" : "Not connected") : null;
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
          {onMore && <ToolbarButton testID={`bt-more:${device.name}`} glyph={MORE} tooltip="More" active={moreOpen} onPress={onMore} />}
        </>
      }
    />
  );
}

/** What opens under a device of yours: Forget this device, then the question in place (Forget in ume: it can't be undone). */
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
  if (!confirming) return <PageRow testID={`bt-forget:${device.name}`} label="Forget this device" onPress={onAsk} />;
  return (
    <View style={{ flexDirection: "column", gap: SPACE.s, paddingLeft: FORGET_INSET, paddingRight: SPACE.s, paddingTop: SPACE.xxs, paddingBottom: SPACE.s }}>
      <View testID="bt-forget-question">
        <Text style={{ fontSize: TYPE.panel.detail.size, lineHeight: TYPE.panel.detail.line, color: colors.text }}>
          {`Forget “${device.name}”? You will need to pair it again.`}
        </Text>
      </View>
      <View style={{ flexDirection: "row", gap: SPACE.m }}>
        <Button testID="bt-forget-cancel" label="Cancel" look="panel" size="small" onPress={onCancel} />
        <Button testID="bt-forget-confirm" label="Forget" look="panel" size="small" danger onPress={onForget} />
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
      {state.mine.length > 0 && <PageSection>My devices</PageSection>}
      {state.mine.map((device) => (
        <View key={device.path} style={{ flexDirection: "column", gap: 6 }}>
          <Row
            device={device}
            busy={state.busy[device.path]}
            idle={idle(device)}
            onChoose={choose}
            onMore={() => setMore(more?.path === device.path ? null : { path: device.path, confirming: false })}
            moreOpen={more?.path === device.path}
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
            <Button testID="bt-search-again" label="Search again" look="panel" size="small" onPress={() => store.searchAgain()} />
          )
        }
      >
        Nearby devices
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
