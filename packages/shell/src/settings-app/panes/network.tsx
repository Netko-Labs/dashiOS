/**
 * Network: Wi-Fi (the radio, the network you are on, the others in range,
 * and the networks you know, each with Forget), Ethernet (its status and
 * address, router, DNS, and MAC from NetworkManager), and the VPNs
 * NetworkManager already has (connect or disconnect; adding one is
 * NetworkManager's own). Wi-Fi is the Control Center's store, so a join here
 * is a join there; a machine without Wi-Fi hardware shows no Wi-Fi. An
 * agent's Wi-Fi rules stay (no passwords): the password is asked on its own
 * sheet.
 */

import { Svg, Text } from "@mirinjs/metal";
import { useEffect, useState } from "react";
import { LOCK } from "../../control-center/glyphs.ts";
import { useDevices } from "../../control-center/index.ts";
import { wifiGlyph } from "../../glyphs.ts";
import { type EthernetInfo, useNetInfo, type VpnConnection } from "../../network/index.ts";
import { chooseNetwork } from "../../wifi/flow.ts";
import { joinMessage } from "../../wifi/networks.ts";
import { useWifi, type WifiState } from "../../wifi/store.ts";
import type { SavedNetwork, WifiNetwork } from "../../wifi/types.ts";
import { useColors } from "../colors.ts";
import { ETHERNET, WIFI } from "../knob-glyphs.ts";
import type { PaneServices } from "../services.ts";
import { Caption, Group, Note, Page, Setting, Switch } from "../ui.tsx";
import { Failure, ListRow, MiniButton, RoundIcon, Value } from "./parts.tsx";

function NetworkRow({ network, current, state, onJoin }: { network: WifiNetwork; current: boolean; state: WifiState; onJoin: (network: WifiNetwork) => void }) {
  const colors = useColors();
  const joining = state.join.phase === "joining";
  const thisOne = state.join.phase === "joining" && state.join.key === network.key;
  const detail = current ? "Connected" : network.known ? "Known network" : network.secured ? "Password required" : "Open";
  return (
    <ListRow
      testID={`net-wifi:${network.ssid}`}
      name={network.ssid}
      detail={detail}
      bold={current}
      leading={<RoundIcon glyph={wifiGlyph(network.bars)} lit={current} />}
    >
      {network.secured && <Svg markup={LOCK} size={11} color={colors.textMuted} />}
      {!current &&
        (thisOne ? (
          <Text style={{ fontSize: 12, color: colors.textMuted }}>Joining…</Text>
        ) : (
          <MiniButton testID={`net-join:${network.ssid}`} label="Join" disabled={joining} onPress={() => onJoin(network)} />
        ))}
    </ListRow>
  );
}

function WifiSection({ services, on, onRadio }: { services: PaneServices; on: boolean; onRadio: (on: boolean) => void }) {
  const { wifi } = services;
  const state = useWifi(wifi);
  const [asking, setAsking] = useState<string | null>(null);
  useEffect(() => {
    wifi.open();
    return () => wifi.close();
  }, [wifi]);
  // Switching the radio on is the moment to look again.
  useEffect(() => {
    if (on) {
      void wifi.refresh();
      void wifi.rescan();
    }
  }, [on, wifi]);

  const join = (network: WifiNetwork) => void chooseNetwork(wifi, network, (secured) => services.askWifiPassword(secured));
  const failure = state.join.phase === "failed" ? `“${state.join.ssid}”: ${joinMessage(state.join.reason)}` : null;
  const known = state.networks.filter((network) => network.known);
  const others = state.networks.filter((network) => !network.known);
  const forget = (saved: SavedNetwork) => {
    setAsking(null);
    void wifi.forget(saved);
  };
  return (
    <>
      <Group testID="net-wifi-switch">
        <Setting
          id="network/wi-fi"
          glyph={WIFI}
          detail={!on ? "Off" : state.current ? `Connected to ${state.current.ssid}` : state.scanning ? "Searching…" : "Not connected"}
        >
          <Switch testID="net-wifi-radio" on={on} onChange={onRadio} />
        </Setting>
      </Group>
      {on && state.available === false && (
        <Group>
          <Note testID="net-wifi-unavailable">Wi-Fi isn't available on this computer.</Note>
        </Group>
      )}
      {on && state.available !== false && (
        <>
          <Group testID="net-wifi-list">
            {state.current && <NetworkRow network={state.current} current state={state} onJoin={join} />}
            {known.map((network) => (
              <NetworkRow key={network.key} network={network} current={false} state={state} onJoin={join} />
            ))}
            {others.map((network) => (
              <NetworkRow key={network.key} network={network} current={false} state={state} onJoin={join} />
            ))}
            {state.current === null && state.networks.length === 0 && (
              <Note testID="net-wifi-none">{state.scanning || state.available === null ? "Searching…" : "No networks found."}</Note>
            )}
          </Group>
          {failure && <Failure testID="net-wifi-failure">{failure}</Failure>}
          {state.saved.length > 0 && (
            <>
              <Caption above>Known Networks</Caption>
              <Group testID="net-known">
                {state.saved.map((saved) => (
                  <ListRow
                    key={saved.key}
                    testID={`net-known:${saved.ssid}`}
                    name={saved.ssid}
                    detail={state.current?.key === saved.key ? "Connected" : "Joins automatically when in range"}
                  >
                    {asking === saved.key ? (
                      <>
                        <MiniButton testID={`net-forget-cancel:${saved.ssid}`} label="Cancel" onPress={() => setAsking(null)} />
                        <MiniButton testID={`net-forget-confirm:${saved.ssid}`} label="Forget" tone="critical" onPress={() => forget(saved)} />
                      </>
                    ) : (
                      <MiniButton testID={`net-forget:${saved.ssid}`} label="Forget…" tone="critical" onPress={() => setAsking(saved.key)} />
                    )}
                  </ListRow>
                ))}
              </Group>
              <Caption>Forgetting a network deletes its saved password; you enter it again to rejoin.</Caption>
            </>
          )}
        </>
      )}
    </>
  );
}

function EthernetSection({ devices }: { devices: readonly EthernetInfo[] }) {
  if (devices.length === 0) return null;
  return (
    <>
      <Caption above>Ethernet</Caption>
      {devices.map((device) => (
        <Group key={device.name} testID={`net-ethernet:${device.name}`}>
          <Setting id="network/status" glyph={ETHERNET} detail={device.connected ? (device.connection ?? device.name) : device.name}>
            <Value testID="net-ethernet-status">{device.connected ? "Connected" : "Not connected"}</Value>
          </Setting>
          {device.connected && (
            <>
              <Setting id="network/ip-address">
                <Value testID="net-ethernet-ip">{device.address ?? "Unknown"}</Value>
              </Setting>
              {device.mask !== null && (
                <Setting id="network/subnet-mask">
                  <Value>{device.mask}</Value>
                </Setting>
              )}
              {device.router !== null && (
                <Setting id="network/router">
                  <Value>{device.router}</Value>
                </Setting>
              )}
              {device.dns.length > 0 && (
                <Setting id="network/dns-servers">
                  <Value testID="net-ethernet-dns">{device.dns}</Value>
                </Setting>
              )}
            </>
          )}
          {device.mac !== null && (
            <Setting id="network/mac-address">
              <Value testID="net-ethernet-mac">{device.mac}</Value>
            </Setting>
          )}
        </Group>
      ))}
    </>
  );
}

function VpnSection({
  vpns,
  busy,
  failed,
  onSet,
}: {
  vpns: readonly VpnConnection[];
  busy: Readonly<Record<string, string>>;
  failed: string | null;
  onSet: (vpn: VpnConnection, up: boolean) => void;
}) {
  return (
    <>
      <Caption above>VPN</Caption>
      <Group testID="net-vpn">
        {vpns.length === 0 ? (
          <Note testID="net-vpn-none">No VPN connections are set up. Add one with NetworkManager (nm-connection-editor or nmcli) and it appears here.</Note>
        ) : (
          vpns.map((vpn) => {
            const working = busy[vpn.uuid];
            return (
              <ListRow
                key={vpn.uuid}
                testID={`net-vpn:${vpn.name}`}
                name={vpn.name}
                detail={
                  working === "connecting"
                    ? "Connecting…"
                    : working === "disconnecting"
                      ? "Disconnecting…"
                      : vpn.active
                        ? "Connected"
                        : vpn.kind === "wireguard"
                          ? "WireGuard"
                          : "Not connected"
                }
              >
                <Switch
                  testID={`net-vpn-switch:${vpn.name}`}
                  on={vpn.active || working === "connecting"}
                  onChange={(up) => working === undefined && onSet(vpn, up)}
                />
              </ListRow>
            );
          })
        )}
      </Group>
      {failed !== null && (
        <Failure testID="net-vpn-failure">{`“${failed}” could not be changed. A VPN that needs a password or a code is connected from NetworkManager's own tools.`}</Failure>
      )}
    </>
  );
}

export function NetworkPane({ services }: { services: PaneServices }) {
  const { devices, netinfo } = services;
  const radios = useDevices(devices);
  const info = useNetInfo(netinfo);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    void devices.refresh().then(() => setLoaded(true));
    netinfo.open();
    return () => netinfo.close();
  }, [devices, netinfo]);

  // No Wi-Fi hardware reads as a radio that cannot be asked (control-center/radios.ts).
  const hasWifi = radios.wifi !== null;
  if (loaded && !hasWifi && info.available === false) {
    return (
      <Page title="Wi-Fi">
        <Group>
          <Note testID="net-unavailable">Network settings aren't available on this computer.</Note>
        </Group>
      </Page>
    );
  }
  return (
    <Page title="Wi-Fi">
      {hasWifi && <WifiSection services={services} on={radios.wifi === true} onRadio={(on) => void devices.setWifi(on)} />}
      <EthernetSection devices={info.ethernet} />
      {info.available !== false && <VpnSection vpns={info.vpns} busy={info.busy} failed={info.failed} onSet={(vpn, up) => void netinfo.setVpn(vpn.uuid, up)} />}
      {loaded && !hasWifi && info.ethernet.length === 0 && info.available === true && (
        <Group>
          <Note testID="net-nothing">This computer has no Wi-Fi or Ethernet connection to show.</Note>
        </Group>
      )}
    </Page>
  );
}
