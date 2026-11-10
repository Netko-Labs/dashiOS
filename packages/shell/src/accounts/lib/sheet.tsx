/**
 * The sheet that changes the password: the current one, the new one, and the
 * new one again. It is a surface of its own that holds the keyboard (like the
 * Wi-Fi password sheet and polkit's), not a window, so nothing an agent can
 * aim at (an agent's pointer and keyboard work in a window it names) reaches
 * it. What is typed goes to `PasswordChanger` and is forgotten with the sheet.
 */

import { useColors } from "@dashi/ui";
import { Text, TextInput, View } from "@mirinjs/metal";
import { useState } from "react";
import { Button, Panel } from "../../menus/sheets.tsx";
import type { PasswordChanger, PasswordFailure } from "../../shared/accounts/types.ts";

const FAILURE: Record<PasswordFailure, string> = {
  "wrong-current": "The current password is incorrect.",
  rejected: "The new password was not accepted.",
  failed: "The password could not be changed.",
  timeout: "Changing the password took too long.",
};

/** Why the three fields cannot be submitted, or null. */
export function passwordProblem(current: string, next: string, again: string, needsCurrent: boolean): string | null {
  if (needsCurrent && current === "") return "Enter your current password.";
  if (next === "") return "Enter a new password.";
  if (next !== again) return again === "" ? "Type the new password again to confirm it." : "The new passwords don't match.";
  if (needsCurrent && next === current) return "The new password must be different.";
  return null;
}

function Field({
  label,
  testID,
  placeholder,
  value,
  onChange,
  onSubmit,
  onCancel,
  autoFocus,
  invalid,
}: {
  label: string;
  testID: string;
  placeholder: string;
  value: string;
  onChange: (text: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  autoFocus?: boolean;
  invalid?: boolean;
}) {
  const colors = useColors();
  return (
    <View style={{ alignSelf: "stretch", flexDirection: "column", gap: 3 }}>
      <Text style={{ fontSize: 11, color: colors.textMuted }}>{label}</Text>
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
          borderColor: invalid ? colors.critical : colors.separator,
        }}
      >
        <TextInput
          testID={testID}
          value={value}
          {...(autoFocus ? { autoFocus: true } : {})}
          secureTextEntry
          placeholder={placeholder}
          onChangeText={onChange}
          onSubmitEditing={onSubmit}
          onKeyPress={(key) => key === "Escape" && onCancel()}
          style={{ fontSize: 13, color: colors.text, placeholderColor: colors.textMuted, backgroundColor: "#00000000" }}
        />
      </View>
    </View>
  );
}

export function PasswordChangeSheet({ changer, needsCurrent, onClose }: { changer: PasswordChanger; needsCurrent: boolean; onClose: () => void }) {
  const colors = useColors();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [working, setWorking] = useState(false);
  const [refusal, setRefusal] = useState<{ reason: PasswordFailure; message: string | null } | null>(null);

  const problem = passwordProblem(current, next, again, needsCurrent);
  const submit = () => {
    if (working || problem !== null) return;
    setWorking(true);
    setRefusal(null);
    void changer.change(current, next).then((result) => {
      if (result.ok) return onClose();
      setWorking(false);
      setRefusal({ reason: result.reason, message: result.message });
      if (result.reason === "wrong-current") setCurrent("");
    });
  };
  const edit = (set: (text: string) => void) => (text: string) => {
    set(text);
    if (refusal) setRefusal(null);
  };

  const refused = refusal ? `${FAILURE[refusal.reason]}${refusal.message ? ` ${refusal.message}.` : ""}` : null;
  const hint = working
    ? "Changing the password…"
    : (refused ?? (problem !== null && (next !== "" || current !== "") ? problem : "Choose a password you will remember."));
  return (
    <Panel>
      <Text style={{ fontSize: 15, fontWeight: "bold", color: colors.text, textAlign: "center" }}>Change Password</Text>
      {needsCurrent && (
        <Field
          label="Current password"
          testID="pw-current"
          placeholder=""
          value={current}
          onChange={edit(setCurrent)}
          onSubmit={submit}
          onCancel={onClose}
          autoFocus
          invalid={refusal?.reason === "wrong-current"}
        />
      )}
      <Field
        label="New password"
        testID="pw-new"
        placeholder=""
        value={next}
        onChange={edit(setNext)}
        onSubmit={submit}
        onCancel={onClose}
        {...(needsCurrent ? {} : { autoFocus: true })}
        invalid={refusal?.reason === "rejected"}
      />
      <Field label="Verify new password" testID="pw-again" placeholder="" value={again} onChange={edit(setAgain)} onSubmit={submit} onCancel={onClose} />
      <View testID="pw-hint" style={{ alignSelf: "stretch" }}>
        <Text style={{ fontSize: 12, color: refusal ? colors.critical : colors.textMuted }}>{hint}</Text>
      </View>
      <View style={{ flexDirection: "row", alignSelf: "stretch", gap: 10, marginTop: 4 }}>
        <Button testID="pw-cancel" label="Cancel" onPress={onClose} />
        <Button testID="pw-change" label={working ? "Changing…" : "Change Password"} primary disabled={working || problem !== null} onPress={submit} />
      </View>
    </Panel>
  );
}
