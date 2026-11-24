/**
 * The sheet that asks for a network's password. Enter joins and Esc cancels
 * (the input is what receives both, so it holds the focus); Join waits for a
 * password the network could accept. While joining it says so, and if the
 * network refuses the password it says that and stays, with what was typed,
 * so a typo is one fix away.
 */

import { AlertSheet, Checkbox, TextField } from "@dashi/ui";
import { useState } from "react";
import { wifiGlyph } from "../../glyphs.ts";
import { joinMessage, passwordProblem } from "../networks.ts";
import { useWifi, type WifiStore } from "../store.ts";
import type { WifiNetwork } from "../types.ts";

/** The alert frame (UI-5) on its own surface: the question, the password field (UI-9) with its line, "Show password", Cancel and Join. */
export function PasswordSheet({ network, wifi, onClose }: { network: WifiNetwork; wifi: WifiStore; onClose: () => void }) {
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
    <AlertSheet
      testID="wifi-sheet"
      place="screen"
      question={`Join “${network.ssid}”?`}
      message="The network needs a password."
      glyph={wifiGlyph(network.bars)}
      buttons={[
        { label: "Cancel", testID: "wifi-cancel", onPress: cancel, cancel: true },
        { label: joining ? "Joining…" : "Join", testID: "wifi-join", onPress: submit, kind: "primary", disabled: joining || problem !== null },
      ]}
    >
      <TextField
        testID="wifi-password"
        value={password}
        autoFocus
        secure={!shown}
        placeholder="Password"
        label={`Password for “${network.ssid}”`}
        onChangeText={(text) => {
          setPassword(text);
          if (refusal) wifi.dismissFailure();
        }}
        onSubmit={submit}
        onKeyPress={(key) => key === "Escape" && cancel()}
        message={hint}
        invalid={refusal !== null}
      />
      <Checkbox testID="wifi-show-password" label="Show password" checked={shown} onChange={setShown} />
    </AlertSheet>
  );
}
