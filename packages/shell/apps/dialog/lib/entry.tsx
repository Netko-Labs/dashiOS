/**
 * `--entry` and `--password`: a prompt and a field (two with `--username`).
 * OK prints what was typed (`user|password` with a username, as Zenity
 * does) and exits 0; Esc and Cancel exit 1. The fields take the keyboard,
 * so Enter and Esc come from them rather than the frame's KeySink.
 */

import { TextField, useColors } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { useState } from "react";
import { type Answer, DialogFrame, standardButtons } from "./frame.tsx";
import type { EntrySpec, PasswordSpec } from "./spec.ts";

function Prompt({ text }: { text: string }) {
  const colors = useColors();
  if (text === "") return null;
  return (
    <View testID="dialog:text">
      <Text style={{ fontSize: 13, color: colors.text, lineHeight: 17 }}>{text}</Text>
    </View>
  );
}

export function EntryDialog({ spec, answer }: { spec: EntrySpec; answer: Answer }) {
  const [text, setText] = useState(spec.entryText);
  const ok = (value: string): void => answer(0, `${value}\n`);
  const buttons = standardButtons({ okLabel: spec.okLabel, cancelLabel: spec.cancelLabel, extraButtons: spec.extraButtons, answer, onOk: () => ok(text) });
  return (
    <DialogFrame title={spec.title} buttons={buttons} onCancel={() => answer(1)} keys={false}>
      <Prompt text={spec.text} />
      <TextField
        testID="dialog:entry"
        value={text}
        autoFocus
        secure={spec.hideText}
        onChangeText={setText}
        onSubmit={ok}
        onKeyPress={(key) => key === "Escape" && answer(1)}
      />
    </DialogFrame>
  );
}

export function PasswordDialog({ spec, answer }: { spec: PasswordSpec; answer: Answer }) {
  const colors = useColors();
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  // Which field has the keyboard; Enter in the username moves on to the password (a remount takes focus).
  const [focus, setFocus] = useState<{ field: "user" | "password"; epoch: number }>({ field: spec.username ? "user" : "password", epoch: 0 });
  const ok = (): void => answer(0, spec.username ? `${user}|${password}\n` : `${password}\n`);
  const buttons = standardButtons({ okLabel: spec.okLabel, cancelLabel: spec.cancelLabel, extraButtons: spec.extraButtons, answer, onOk: ok });
  const escape = (key: string): void => {
    if (key === "Escape") answer(1);
  };
  const label = (text: string) => <Text style={{ fontSize: 12, color: colors.textMuted }}>{text}</Text>;
  const passwordField = (
    <TextField
      key={focus.field === "password" ? `password:${focus.epoch}` : "password"}
      testID="dialog:password"
      value={password}
      secure
      autoFocus={focus.field === "password"}
      onChangeText={setPassword}
      onSubmit={ok}
      onKeyPress={escape}
    />
  );
  return (
    <DialogFrame title={spec.title} buttons={buttons} onCancel={() => answer(1)} keys={false}>
      <Prompt text={spec.text} />
      {spec.username ? (
        <View style={{ flexDirection: "column", gap: 6, flexShrink: 0 }}>
          {label("Username")}
          <TextField
            key={focus.field === "user" ? `user:${focus.epoch}` : "user"}
            testID="dialog:username"
            value={user}
            autoFocus={focus.field === "user"}
            onChangeText={setUser}
            onSubmit={() => setFocus((now) => ({ field: "password", epoch: now.epoch + 1 }))}
            onKeyPress={escape}
          />
          {label("Password")}
          {passwordField}
        </View>
      ) : (
        passwordField
      )}
    </DialogFrame>
  );
}
