/**
 * Control Center's Wi-Fi page, the way macOS lays it out: a back arrow, the
 * radio switch, and one card listing the network you are on (checked), then
 * the networks you know, then the others. Each row is the name, a lock if
 * the network is secured, and the signal. A scan in progress shows as a
 * quiet "Searching…" at the end of the list, so rows do not jump as it fills.
 */

import { Svg, Text, View } from "@mirinjs/metal";
import { type ReactNode, useEffect, useRef } from "react";
import { CHEVRON_LEFT, LOCK } from "../control-center/glyphs.ts";
import { wifiGlyph } from "../glyphs.ts";
import { CHECK, useColors } from "@dashi/ui";
import { joinMessage } from "./networks.ts";
import { type JoinState, useWifi, type WifiState, type WifiStore } from "./store.ts";
import { Switch } from "./switch.tsx";
import type { WifiNetwork } from "./types.ts";

/** The card shows this many pixels of rows, then scrolls. */
const LIST_HEIGHT = 300;

function Row({ network, current, join, onChoose }: { network: WifiNetwork; current: boolean; join: JoinState; onChoose: (network: WifiNetwork) => void }) {
  const colors = useColors();
  const joining = join.phase === "joining" && join.key === network.key;
  return (
    <View
      testID={`wifi-row:${network.ssid}`}
      onPress={current || join.phase === "joining" ? undefined : () => onChoose(network)}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        height: 30,
        paddingLeft: 6,
        paddingRight: 10,
        borderRadius: 8,
        hoverBackgroundColor: colors.button,
      }}
    >
      <View style={{ width: 16, alignItems: "center" }}>{current && <Svg markup={CHECK} size={13} color={colors.text} />}</View>
      <View style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
        <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: current ? "semibold" : "normal", color: colors.text }}>
          {network.ssid}
        </Text>
      </View>
      {joining ? (
        <Text style={{ fontSize: 11, color: colors.textMuted }}>Joining…</Text>
      ) : (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
          {network.secured && <Svg markup={LOCK} size={11} color={colors.textMuted} />}
          <Svg markup={wifiGlyph(network.bars)} size={15} color={colors.text} />
        </View>
      )}
    </View>
  );
}

function Caption({ children }: { children: string }) {
  const colors = useColors();
  return (
    <View style={{ paddingLeft: 8, paddingTop: 6, paddingBottom: 2 }}>
      <Text style={{ fontSize: 11, fontWeight: "semibold", color: colors.textMuted }}>{children}</Text>
    </View>
  );
}

function Note({ children }: { children: string }) {
  const colors = useColors();
  return (
    <View testID="wifi-note" style={{ height: 56, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ fontSize: 12, color: colors.textMuted }}>{children}</Text>
    </View>
  );
}

function List({ state, onChoose }: { state: WifiState; onChoose: (network: WifiNetwork) => void }) {
  const colors = useColors();
  const known = state.networks.filter((network) => network.known);
  const others = state.networks.filter((network) => !network.known);
  const rows = (networks: readonly WifiNetwork[]): ReactNode =>
    networks.map((network) => <Row key={network.key} network={network} current={false} join={state.join} onChoose={onChoose} />);
  const empty = state.current === null && state.networks.length === 0;
  if (empty && !state.scanning && state.available !== null) return <Note>No networks found</Note>;
  return (
    <View style={{ flexDirection: "column", maxHeight: LIST_HEIGHT, overflow: "scroll" }}>
      {state.current && <Row network={state.current} current join={state.join} onChoose={onChoose} />}
      {known.length > 0 && <Caption>Known Networks</Caption>}
      {rows(known)}
      {others.length > 0 && <Caption>{known.length > 0 || state.current ? "Other Networks" : "Networks"}</Caption>}
      {rows(others)}
      {(state.scanning || state.available === null) && (
        <View testID="wifi-searching" style={{ height: 28, justifyContent: "center", paddingLeft: 28 }}>
          <Text style={{ fontSize: 12, color: colors.textMuted }}>Searching…</Text>
        </View>
      )}
    </View>
  );
}

export interface WifiPageProps {
  wifi: WifiStore;
  /** The radio; null when it cannot be read. */
  radio: boolean | null;
  onRadio: (on: boolean) => void;
  onChoose: (network: WifiNetwork) => void;
  onBack: () => void;
}

export function WifiPage({ wifi, radio, onRadio, onChoose, onBack }: WifiPageProps) {
  const colors = useColors();
  const state = useWifi(wifi);
  useEffect(() => {
    wifi.open();
    return () => wifi.close();
  }, [wifi]);
  // Turning the radio on is the moment to look again; the first render is the open's.
  const before = useRef(radio);
  useEffect(() => {
    if (radio && !before.current) {
      void wifi.refresh();
      void wifi.rescan();
    }
    before.current = radio;
  }, [radio, wifi]);

  const on = radio !== false;
  const failure = state.join.phase === "failed" ? `“${state.join.ssid}”: ${joinMessage(state.join.reason)}` : null;
  return (
    <>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4, height: 28 }}>
        <View
          testID="wifi-back"
          onPress={onBack}
          style={{ width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", hoverBackgroundColor: colors.button }}
        >
          <Svg markup={CHEVRON_LEFT} size={14} color={colors.text} />
        </View>
        <Text style={{ fontSize: 14, fontWeight: "bold", color: colors.text }}>Wi-Fi</Text>
        <View style={{ marginLeft: "auto" }}>
          <Switch testID="wifi-switch" on={on} onChange={onRadio} />
        </View>
      </View>
      <View testID="wifi-list" style={{ flexDirection: "column", padding: 4, borderRadius: 12, backgroundColor: colors.tile }}>
        {!on ? (
          <Note>Wi-Fi is off</Note>
        ) : state.available === false ? (
          <Note>Wi-Fi isn't available on this computer</Note>
        ) : (
          <List state={state} onChoose={onChoose} />
        )}
      </View>
      {failure && on && (
        <View testID="wifi-failure" style={{ paddingLeft: 6 }}>
          <Text style={{ fontSize: 11, color: colors.critical }}>{failure}</Text>
        </View>
      )}
    </>
  );
}
