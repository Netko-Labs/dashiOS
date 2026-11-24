/**
 * The sheet that changes the password: the current one, the new one, and the
 * new one again. It is a surface of its own that holds the keyboard (like the
 * Wi-Fi password sheet and polkit's), not a window, so nothing an agent can
 * aim at (an agent's pointer and keyboard work in a window it names) reaches
 * it. What is typed goes to `PasswordChanger` and is forgotten with the sheet.
 * A form sheet (UI-15) in the app look (SE-15): solid, over the scrim, hung
 * from Settings' title row when the shell knows where Settings is (prompt.tsx),
 * centred on the screen when it doesn't.
 */

import { ALERT_WINDOW, FormSheet, RADIUS, TextField, TYPE, useColors } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { useState } from "react";
import type { PasswordChanger, PasswordFailure } from "../../shared/accounts/index.ts";

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

/** Where the sheet is: over Settings' window (`window`), or on the screen when Settings can't be found. */
export type PasswordSheetPlace = "window" | "screen";

export function PasswordChangeSheet({
  changer,
  needsCurrent,
  onClose,
  place = "screen",
}: {
  changer: PasswordChanger;
  needsCurrent: boolean;
  onClose: () => void;
  place?: PasswordSheetPlace;
}) {
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
  const keys = (key: string) => key === "Escape" && onClose();

  const refused = refusal ? `${FAILURE[refusal.reason]}${refusal.message ? ` ${refusal.message}.` : ""}` : null;
  const hint = working
    ? "Changing the password…"
    : (refused ?? (problem !== null && (next !== "" || current !== "") ? problem : "Choose a password you will remember."));
  const sheet = (
    <FormSheet
      testID="pw-sheet"
      title="Change password"
      place={place}
      // Over Settings: under its title row, the strip its window controls sit in.
      {...(place === "window" ? { hang: ALERT_WINDOW.strip } : {})}
      buttons={[
        { label: "Cancel", testID: "pw-cancel", onPress: onClose, cancel: true },
        { label: working ? "Changing…" : "Change password", testID: "pw-change", onPress: submit, kind: "primary", disabled: working || problem !== null },
      ]}
    >
      {needsCurrent && (
        <TextField
          testID="pw-current"
          value={current}
          secure
          autoFocus
          placeholder="Current password"
          onChangeText={edit(setCurrent)}
          onSubmit={submit}
          onKeyPress={keys}
          invalid={refusal?.reason === "wrong-current"}
        />
      )}
      <TextField
        testID="pw-new"
        value={next}
        secure
        {...(needsCurrent ? {} : { autoFocus: true })}
        placeholder="New password"
        onChangeText={edit(setNext)}
        onSubmit={submit}
        onKeyPress={keys}
        invalid={refusal?.reason === "rejected"}
      />
      <TextField testID="pw-again" value={again} secure placeholder="Verify new password" onChangeText={edit(setAgain)} onSubmit={submit} onKeyPress={keys} />
      <View testID="pw-hint">
        <Text style={{ fontSize: TYPE.caption.size, lineHeight: TYPE.caption.line, color: refusal ? colors.ume : colors.textMuted }}>{hint}</Text>
      </View>
    </FormSheet>
  );
  // Over Settings the scrim takes the window's rounded corners.
  return place === "window" ? <View style={{ flex: 1, borderRadius: RADIUS.sheet, overflow: "hidden" }}>{sheet}</View> : sheet;
}
