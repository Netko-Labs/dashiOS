/**
 * Control Center's Wi-Fi page, grown out of the Wi-Fi tile (control-center/
 * page-parts.tsx): the tile is its header (back, the network you are on, the
 * radio's switch), then the networks you know, then the others, each a row
 * with its signal on the knob and a lock if it is secured. A scan in
 * progress is a quiet "Searching…" at the end, so rows do not jump as it
 * fills; "Wi-Fi Settings…" is last.
 */

import { Svg, View } from "@mirinjs/metal";
import { type ReactNode, useEffect, useRef } from "react";
import { PADLOCK } from "../control-center/glyphs.ts";
import { PageBody, PageHeader, PageNote, PageRow, PageSection } from "../control-center/page-parts.tsx";
import { useControlColors } from "../control-center/palette.ts";
import { wifiGlyph } from "../glyphs.ts";
import { joinMessage } from "./networks.ts";
import { type JoinState, useWifi, type WifiState, type WifiStore } from "./store.ts";
import type { WifiNetwork } from "./types.ts";

function Row({ network, join, onChoose }: { network: WifiNetwork; join: JoinState; onChoose: (network: WifiNetwork) => void }) {
  const colors = useControlColors();
  const joining = join.phase === "joining" && join.key === network.key;
  return (
    <PageRow
      testID={`wifi-row:${network.ssid}`}
      label={network.ssid}
      glyph={wifiGlyph(network.bars)}
      detail={joining ? "Joining…" : null}
      trailing={!joining && network.secured ? <Svg markup={PADLOCK} size={14} color={colors.offInk} /> : undefined}
      {...(join.phase === "joining" ? {} : { onPress: () => onChoose(network) })}
    />
  );
}

function List({ state, onChoose }: { state: WifiState; onChoose: (network: WifiNetwork) => void }) {
  const known = state.networks.filter((network) => network.known);
  const others = state.networks.filter((network) => !network.known);
  const rows = (networks: readonly WifiNetwork[]): ReactNode =>
    networks.map((network) => <Row key={network.key} network={network} join={state.join} onChoose={onChoose} />);
  const empty = state.current === null && state.networks.length === 0;
  if (empty && !state.scanning && state.available !== null) return <PageNote testID="wifi-note">No networks found</PageNote>;
  return (
    <>
      {known.length > 0 && <PageSection>Known Networks</PageSection>}
      {rows(known)}
      {others.length > 0 && <PageSection>{known.length > 0 || state.current ? "Other Networks" : "Networks"}</PageSection>}
      {rows(others)}
      {(state.scanning || state.available === null) && <PageNote testID="wifi-searching">Searching…</PageNote>}
    </>
  );
}

export interface WifiPageProps {
  wifi: WifiStore;
  /** The radio; null when it cannot be read. */
  radio: boolean | null;
  onRadio: (on: boolean) => void;
  onChoose: (network: WifiNetwork) => void;
  onBack: () => void;
  /** "Wi-Fi Settings…": System Settings' Network pane. */
  onSettings?: () => void;
}

/** The list shows this many points of rows, then scrolls. */
const LIST_HEIGHT = 330;

export function WifiPage({ wifi, radio, onRadio, onChoose, onBack, onSettings }: WifiPageProps) {
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
      <PageHeader
        testID="wifi-header"
        title="Wi-Fi"
        detail={!on ? "Off" : (state.current?.ssid ?? "Not Connected")}
        on={on}
        onBack={onBack}
        toggle={{ on, onChange: onRadio }}
      />
      <PageBody testID="wifi-list">
        <View style={{ flexDirection: "column", gap: 6, maxHeight: LIST_HEIGHT, overflow: "scroll" }}>
          {!on ? (
            <PageNote>Wi-Fi is off</PageNote>
          ) : state.available === false ? (
            <PageNote>Wi-Fi isn't available on this computer</PageNote>
          ) : (
            <List state={state} onChoose={onChoose} />
          )}
        </View>
        {failure && on && (
          <PageNote testID="wifi-failure" tone="critical">
            {failure}
          </PageNote>
        )}
        {onSettings && (
          <>
            <PageSection>More</PageSection>
            <PageRow testID="wifi-settings" label="Wi-Fi Settings…" onPress={onSettings} />
          </>
        )}
      </PageBody>
    </>
  );
}
