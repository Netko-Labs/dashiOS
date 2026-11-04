import { CHECK, useColors } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import { useEffect } from "react";
import { LOCK } from "../../control-center/glyphs.ts";
import { wifiGlyph } from "../../glyphs.ts";
import { Group, Note } from "../../settings-app/ui.tsx";
import { chooseNetwork } from "../../wifi/flow.ts";
import { joinMessage } from "../../wifi/networks.ts";
import { useWifi, type WifiStore } from "../../wifi/store.ts";
import type { WifiNetwork } from "../../wifi/types.ts";
import type { SetupContext } from "../context.ts";

function NetworkRow({ network, current, joining, onChoose }: { network: WifiNetwork; current: boolean; joining: boolean; onChoose: () => void }) {
  const colors = useColors();
  return (
    <View
      testID={`setup-wifi:${network.ssid}`}
      onPress={current || joining ? undefined : onChoose}
      style={{ height: 36, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, hoverBackgroundColor: colors.button }}
    >
      <View style={{ width: 16, alignItems: "center" }}>{current && <Svg markup={CHECK} size={13} color={colors.text} />}</View>
      <View style={{ flex: 1, minWidth: 0 }}>
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

/** Follows the Wi-Fi store for as long as the page is up. */
export function useWifiPage(wifi: WifiStore) {
  useEffect(() => {
    wifi.open();
    return () => wifi.close();
  }, [wifi]);
  return useWifi(wifi);
}

/**
 * The Wi-Fi list the menu bar has. A password is asked on the shell's own sheet, never in this
 * window, so nothing typed here can be a password and the sheet's keyboard is the person's.
 */
export function WifiPage({ ctx }: { ctx: SetupContext }) {
  const colors = useColors();
  const state = useWifiPage(ctx.wifi);
  const rows = [...(state.current ? [state.current] : []), ...state.networks];
  const failure = state.join.phase === "failed" ? `“${state.join.ssid}”: ${joinMessage(state.join.reason)}` : null;
  return (
    <>
      <Group testID="setup-wifi-list">
        {state.available === false ? (
          <Note testID="setup-wifi-none">Wi-Fi isn't available on this computer.</Note>
        ) : rows.length === 0 ? (
          <Note testID="setup-wifi-empty">{state.scanning || state.available === null ? "Searching…" : "No networks found."}</Note>
        ) : (
          <View style={{ flexDirection: "column", maxHeight: 250, overflow: "scroll" }}>
            {rows.map((network) => (
              <NetworkRow
                key={network.key}
                network={network}
                current={network.key === state.current?.key}
                joining={state.join.phase === "joining" && state.join.key === network.key}
                onChoose={() => void chooseNetwork(ctx.wifi, network, ctx.askPassword)}
              />
            ))}
          </View>
        )}
      </Group>
      {failure && (
        <View testID="setup-wifi-failure" style={{ flexShrink: 0 }}>
          <Text style={{ fontSize: 11, color: colors.critical }}>{failure}</Text>
        </View>
      )}
    </>
  );
}
