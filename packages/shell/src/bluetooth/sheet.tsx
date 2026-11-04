/**
 * The sheets pairing asks questions on, one at a time, centered, holding the
 * keyboard until answered (the same kind of surface as the power sheets and
 * the Wi-Fi password). Which one shows is whatever BlueZ is asking, held in
 * the store: a code to compare (Pair / Cancel), a device that wants to pair
 * (Pair / Cancel), a code to type on the device (read-only, it goes away
 * when the device has it), or a PIN or passkey to type here.
 *
 * Esc cancels everywhere. Enter confirms only where there is something typed
 * to confirm: a stray Enter must not pair a device.
 */

import { useColors } from "@dashi/ui";
import { Svg, Text, TextInput, View } from "@mirinjs/metal";
import { type ReactNode, useState } from "react";
import { BLUETOOTH } from "../control-center/glyphs.ts";
import { Button, Panel } from "../menus/sheets.tsx";
import { KeyCatcher } from "../overlay.tsx";
import type { BluetoothStore } from "./store.ts";
import { useBluetooth } from "./store.ts";
import type { PairingRequest } from "./types.ts";
import { isPin } from "./values.ts";

const Title = ({ children }: { children: string }) => {
  const colors = useColors();
  return <Text style={{ fontSize: 15, fontWeight: "bold", color: colors.text, textAlign: "center" }}>{children}</Text>;
};

const Hint = ({ children, bad }: { children: string; bad?: boolean }) => {
  const colors = useColors();
  return (
    <View style={{ alignSelf: "stretch" }}>
      <Text style={{ fontSize: 12, color: bad ? colors.critical : colors.textMuted, textAlign: "center" }}>{children}</Text>
    </View>
  );
};

/** A code to read, big; the first `typed` digits are lit as the device takes them. */
function Code({ code, typed = 0 }: { code: string; typed?: number }) {
  const colors = useColors();
  return (
    <View testID="bt-code" style={{ flexDirection: "row", gap: 3, paddingTop: 4, paddingBottom: 4 }}>
      {[...code].map((digit, index) => (
        <Text key={index} style={{ fontSize: 30, fontWeight: "bold", fontFamily: "monospace", color: index < typed ? colors.selection : colors.text }}>
          {digit}
        </Text>
      ))}
    </View>
  );
}

function Frame({ children }: { children: ReactNode }) {
  const colors = useColors();
  return (
    <Panel>
      <Svg markup={BLUETOOTH} size={28} color={colors.text} />
      {children}
    </Panel>
  );
}

/** Pair / Cancel, or just Cancel when there is nothing to agree to. */
function Answer({ store, pair }: { store: BluetoothStore; pair: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignSelf: "stretch", gap: 10, marginTop: 4 }}>
      <Button testID="bt-cancel" label="Cancel" onPress={() => store.decline()} />
      {pair && <Button testID="bt-pair" label="Pair" primary onPress={() => store.answer()} />}
    </View>
  );
}

/** A PIN or a passkey typed here. */
function Entry({ store, request }: { store: BluetoothStore; request: Extract<PairingRequest, { kind: "enter-pin" | "enter-passkey" }> }) {
  const colors = useColors();
  const [text, setText] = useState("");
  const pin = request.kind === "enter-pin";
  const valid = pin ? isPin(text) : /^\d{1,6}$/.test(text);
  const submit = () => valid && store.answer(text);
  const hint =
    text !== "" && !valid
      ? pin
        ? "A PIN is 1 to 16 letters, numbers, or symbols."
        : "The code is up to six digits."
      : pin
        ? "Many devices use 0000 or 1234. For a keyboard, pick any PIN, then type it on the keyboard and press Enter."
        : "Type the digits the device is showing.";
  return (
    <Frame>
      <Title>{pin ? `Enter the PIN for “${request.name}”` : `Enter the code shown on “${request.name}”`}</Title>
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
          borderColor: colors.separator,
        }}
      >
        <TextInput
          testID="bt-entry"
          value={text}
          autoFocus
          placeholder={pin ? "PIN" : "Code"}
          onChangeText={setText}
          onSubmitEditing={submit}
          onKeyPress={(key) => key === "Escape" && store.decline()}
          style={{ fontSize: 13, color: colors.text, placeholderColor: colors.textMuted, backgroundColor: "#00000000" }}
        />
      </View>
      <Hint bad={text !== "" && !valid}>{hint}</Hint>
      <View style={{ flexDirection: "row", alignSelf: "stretch", gap: 10, marginTop: 4 }}>
        <Button testID="bt-cancel" label="Cancel" onPress={() => store.decline()} />
        <Button testID="bt-pair" label="Pair" primary disabled={!valid} onPress={submit} />
      </View>
    </Frame>
  );
}

/** What is on the sheet for this request. */
function Sheet({ store, request }: { store: BluetoothStore; request: PairingRequest }) {
  switch (request.kind) {
    case "confirm":
      return (
        <Frame>
          <KeyCatcher onKey={(key) => key === "Escape" && store.decline()} />
          <Title>{`Pair with “${request.name}”?`}</Title>
          <Hint>Make sure this code matches the one shown on the device.</Hint>
          <Code code={request.passkey} />
          <Answer store={store} pair />
        </Frame>
      );
    case "authorize":
      return (
        <Frame>
          <KeyCatcher onKey={(key) => key === "Escape" && store.decline()} />
          <Title>{`“${request.name}” wants to pair with this computer.`}</Title>
          <Hint>Only pair with a device you recognize.</Hint>
          <Answer store={store} pair />
        </Frame>
      );
    case "show-passkey":
      return (
        <Frame>
          <KeyCatcher onKey={(key) => key === "Escape" && store.decline()} />
          <Title>{`Pair with “${request.name}”`}</Title>
          <Hint>Type this code on the device, then press Enter.</Hint>
          <Code code={request.passkey} typed={request.entered} />
          <Answer store={store} pair={false} />
        </Frame>
      );
    case "show-pin":
      return (
        <Frame>
          <KeyCatcher onKey={(key) => key === "Escape" && store.decline()} />
          <Title>{`Pair with “${request.name}”`}</Title>
          <Hint>Type this PIN on the device, then press Enter.</Hint>
          <Code code={request.pin} />
          <Answer store={store} pair={false} />
        </Frame>
      );
    case "enter-pin":
    case "enter-passkey":
      return <Entry store={store} request={request} />;
  }
}

export function PairingSheet({ bluetooth }: { bluetooth: BluetoothStore }) {
  const { prompt } = useBluetooth(bluetooth);
  // A new question is a new sheet: what was typed for the last one does not carry over.
  return prompt ? <Sheet key={`${prompt.path}:${prompt.kind}`} store={bluetooth} request={prompt} /> : null;
}
