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

import { type AlertButton, AlertSheet, KeySink, SPACE, TextField, TYPE, useColors, WEIGHT } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { type ReactNode, useState } from "react";
import { BLUETOOTH } from "../../control-center/index.ts";
import type { BluetoothStore } from "../store.ts";
import { useBluetooth } from "../store.ts";
import type { PairingRequest } from "../types.ts";
import { isPin } from "./values.ts";

/** A code to read, big; the first `typed` digits are in ink as the device takes them, the rest muted. */
function Code({ code, typed }: { code: string; typed?: number }) {
  const colors = useColors();
  return (
    <View testID="bt-code" style={{ flexDirection: "row", gap: SPACE.xs }}>
      {[...code].map((digit, index) => (
        <Text
          key={index}
          style={{
            fontSize: TYPE.figure.size,
            lineHeight: TYPE.figure.line,
            fontWeight: WEIGHT.bold,
            fontFamily: "monospace",
            color: typed === undefined || index < typed ? colors.text : colors.textMuted,
          }}
        >
          {digit}
        </Text>
      ))}
    </View>
  );
}

/**
 * The alert frame (UI-5) on its own surface, with Bluetooth's glyph. Esc
 * cancels everywhere; `enter` false where nothing typed is there to confirm,
 * so a stray Enter neither pairs nor cancels.
 */
function Frame({
  store,
  question,
  message,
  pair,
  enter = true,
  children,
}: {
  store: BluetoothStore;
  question: string;
  message: string;
  /** Pair beside Cancel: what Enter never presses here (only a click pairs). */
  pair: boolean;
  enter?: boolean;
  children?: ReactNode;
}) {
  const buttons: AlertButton[] = [
    { label: "Cancel", testID: "bt-cancel", onPress: () => store.decline(), cancel: true, isDefault: false },
    ...(pair ? [{ label: "Pair", testID: "bt-pair", onPress: () => store.answer(), kind: "primary" as const, isDefault: false }] : []),
  ];
  return (
    <AlertSheet testID="bt-sheet" place="screen" question={question} message={message} glyph={BLUETOOTH} buttons={buttons} keys={enter}>
      {!enter && <KeySink testID="bt-sheet:esc" onKey={(key) => key.kind === "escape" && store.decline()} />}
      {children}
    </AlertSheet>
  );
}

/** A PIN or a passkey typed here: Enter pairs once what is typed could be one. */
function Entry({ store, request }: { store: BluetoothStore; request: Extract<PairingRequest, { kind: "enter-pin" | "enter-passkey" }> }) {
  const [text, setText] = useState("");
  const pin = request.kind === "enter-pin";
  const valid = pin ? isPin(text) : /^\d{1,6}$/.test(text);
  const submit = () => valid && store.answer(text);
  const wrong = text !== "" && !valid;
  const hint = wrong
    ? pin
      ? "A PIN is 1 to 16 letters, numbers, or symbols."
      : "The code is up to six digits."
    : pin
      ? "Many devices use 0000 or 1234. For a keyboard, pick any PIN, then type it on the keyboard and press Enter."
      : "Type the digits the device is showing.";
  return (
    <AlertSheet
      testID="bt-sheet"
      place="screen"
      question={pin ? `Enter the PIN for “${request.name}”` : `Enter the code shown on “${request.name}”`}
      glyph={BLUETOOTH}
      buttons={[
        { label: "Cancel", testID: "bt-cancel", onPress: () => store.decline(), cancel: true },
        { label: "Pair", testID: "bt-pair", onPress: submit, kind: "primary", disabled: !valid },
      ]}
    >
      <TextField
        testID="bt-entry"
        value={text}
        autoFocus
        placeholder={pin ? "PIN" : "Code"}
        onChangeText={setText}
        onSubmit={submit}
        onKeyPress={(key) => key === "Escape" && store.decline()}
        message={hint}
        invalid={wrong}
      />
    </AlertSheet>
  );
}

/** What is on the sheet for this request. */
function PairingQuestion({ store, request }: { store: BluetoothStore; request: PairingRequest }) {
  switch (request.kind) {
    case "confirm":
      return (
        <Frame store={store} question={`Pair with “${request.name}”?`} message="Make sure this code matches the one shown on the device." pair>
          <Code code={request.passkey} />
        </Frame>
      );
    case "authorize":
      return (
        <Frame
          store={store}
          question={`Pair with “${request.name}”?`}
          message="It wants to pair with this computer. Only pair with a device you recognize."
          pair
        />
      );
    case "show-passkey":
      return (
        <Frame store={store} question={`Type this code on “${request.name}”`} message="Then press Enter on the device." pair={false} enter={false}>
          <Code code={request.passkey} typed={request.entered} />
        </Frame>
      );
    case "show-pin":
      return (
        <Frame store={store} question={`Type this PIN on “${request.name}”`} message="Then press Enter on the device." pair={false} enter={false}>
          <Code code={request.pin} />
        </Frame>
      );
    case "enter-pin":
    case "enter-passkey":
      return <Entry store={store} request={request} />;
  }
}

export function PairingQuestions({ bluetooth }: { bluetooth: BluetoothStore }) {
  const { prompt } = useBluetooth(bluetooth);
  // A new question is a new sheet: what was typed for the last one does not carry over.
  return prompt ? <PairingQuestion key={`${prompt.path}:${prompt.kind}`} store={bluetooth} request={prompt} /> : null;
}
