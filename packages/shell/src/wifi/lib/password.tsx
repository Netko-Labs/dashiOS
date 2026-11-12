/**
 * The sheet that asks for a network's password. Enter joins and Esc cancels
 * (the input is what receives both, so it holds the focus); Join waits for a
 * password the network could accept. While joining it says so, and if the
 * network refuses the password it says that and stays, with what was typed,
 * so a typo is one fix away.
 */

import { CHECK, useColors } from "@dashi/ui";
import { Svg, Text, TextInput, View } from "@mirinjs/metal";
import { useState } from "react";
import { wifiGlyph } from "../../glyphs.ts";
import { Button, Panel } from "../../menus/sheets.tsx";
import { joinMessage, passwordProblem } from "../networks.ts";
import { useWifi, type WifiStore } from "../store.ts";
import type { WifiNetwork } from "../types.ts";

function ShowPassword({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  const colors = useColors();
  return (
    <View testID="wifi-show-password" onPress={onToggle} style={{ alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6 }}>
      <View
        style={{
          width: 15,
          height: 15,
          borderRadius: 4,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: shown ? colors.selection : colors.tile,
          borderWidth: 1,
          borderColor: shown ? colors.selection : colors.checkbox,
        }}
      >
        {shown && <Svg markup={CHECK} size={10} color="#ffffff" />}
      </View>
      <Text style={{ fontSize: 12, color: colors.text }}>Show password</Text>
    </View>
  );
}

export function PasswordSheet({ network, wifi, onClose }: { network: WifiNetwork; wifi: WifiStore; onClose: () => void }) {
  const colors = useColors();
  const { join } = useWifi(wifi);
  const [password, setPassword] = useState("");
  const [shown, setShown] = useState(false);

  const mine = join.phase !== "idle" && join.key === network.key;
  const joining = mine && join.phase === "joining";
  const refusal = mine && join.phase === "failed" ? joinMessage(join.reason) : null;
  const problem = passwordProblem(network.security, password);

  const cancel = () => {
    wifi.dismissFailure();
    onClose();
  };
  const submit = () => {
    if (joining || problem !== null) return;
    void wifi.join(network, password).then((result) => result.ok && onClose());
  };

  const hint = joining ? "Joining…" : (refusal ?? (password !== "" && problem !== null ? problem : "Enter the password to join."));
  return (
    <Panel>
      <Svg markup={wifiGlyph(network.bars)} size={30} color={colors.text} />
      <Text
        style={{ fontSize: 15, fontWeight: "bold", color: colors.text, textAlign: "center" }}
      >{`The Wi-Fi network “${network.ssid}” requires a password.`}</Text>
      <View
        style={{
          alignSelf: "stretch",
          height: 30,
          justifyContent: "center",
          paddingLeft: 10,
          paddingRight: 10,
          borderRadius: 7,
          backgroundColor: colors.tile,
          borderWidth: 1,
          borderColor: refusal ? colors.critical : colors.separator,
        }}
      >
        <TextInput
          testID="wifi-password"
          value={password}
          autoFocus
          secureTextEntry={!shown}
          placeholder="Password"
          onChangeText={(text) => {
            setPassword(text);
            if (refusal) wifi.dismissFailure();
          }}
          onSubmitEditing={submit}
          onKeyPress={(key) => key === "Escape" && cancel()}
          style={{ fontSize: 13, color: colors.text, placeholderColor: colors.textMuted, backgroundColor: "#00000000" }}
        />
      </View>
      <ShowPassword shown={shown} onToggle={() => setShown(!shown)} />
      <View testID="wifi-hint" style={{ alignSelf: "stretch" }}>
        <Text style={{ fontSize: 12, color: refusal ? colors.critical : colors.textMuted }}>{hint}</Text>
      </View>
      <View style={{ flexDirection: "row", alignSelf: "stretch", gap: 10, marginTop: 4 }}>
        <Button testID="wifi-cancel" label="Cancel" onPress={cancel} />
        <Button testID="wifi-join" label={joining ? "Joining…" : "Join"} primary disabled={joining || problem !== null} onPress={submit} />
      </View>
    </Panel>
  );
}
