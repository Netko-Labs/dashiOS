/**
 * An account's row in an extension's Settings… (frame S5): who is connected,
 * where the key is, and Disconnect; or Connect… (Dashi signs in, in Helium,
 * with PKCE; the first time it asks once, in the row) and Paste a Token…
 * (checked with the provider before it is kept). The token never shows.
 */

import type { Manifest } from "@dashi/applet";
import { Button, TextField, useColors } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { useState } from "react";
import { type AccountRow, canSignIn, type ExtensionAccounts } from "../../../../src/shared/extension-settings/index.ts";

/** What the row says: who is connected, the one question, the wait, or why not. */
function wordsOf(row: AccountRow, step: Step, extension: string): { title: string; detail: string } {
  const provider = row.provider;
  const name = provider?.name ?? row.id;
  if (row.login !== null) return { title: `${row.login} on ${row.id}`, detail: provider?.kept ?? "The key is in your keyring." };
  if (step.kind === "ask") return { title: `Sign in to ${name} for ${extension}?`, detail: provider?.kept ?? "" };
  if (step.kind === "waiting") return { title: `Waiting for ${name} in Helium…`, detail: "Say yes there; this comes back by itself." };
  if (step.kind === "failed") return { title: "Not connected", detail: step.words };
  return {
    title: "Not connected",
    detail: canSignIn(provider) ? `Connect, or paste a ${name} token` : `Paste a ${name} token: Dashi's sign-in isn't set up in this build`,
  };
}

type Step = { kind: "idle" } | { kind: "ask" } | { kind: "waiting" } | { kind: "paste"; token: string } | { kind: "failed"; words: string };

export function AccountSetting({
  manifest,
  row,
  accounts,
  open,
  changed,
}: {
  manifest: Manifest;
  row: AccountRow;
  accounts: ExtensionAccounts;
  open: (url: string) => void;
  changed: () => void;
}) {
  const colors = useColors();
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const provider = row.provider;
  const name = provider?.name ?? row.id;
  const done = (outcome: { login: string } | { error: string }): void => {
    setStep("error" in outcome ? { kind: "failed", words: outcome.error } : { kind: "idle" });
    changed();
  };
  const signIn = (): void => {
    if (!provider) return;
    accounts.agreed(manifest, provider.id);
    setStep({ kind: "waiting" });
    const opened = async (url: string): Promise<boolean> => {
      open(url);
      return true;
    };
    void accounts.connect(manifest, provider, { open: opened }).then(done);
  };
  const words = wordsOf(row, step, manifest.name);
  return (
    <View style={{ flexDirection: "column", gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
        <View style={{ flex: 1, minWidth: 0, flexDirection: "column", gap: 2 }}>
          <Text style={{ fontSize: 13, fontWeight: row.login ? "semibold" : "normal", color: colors.text }}>{words.title}</Text>
          <Text style={{ fontSize: 11, color: step.kind === "failed" ? colors.critical : colors.textMuted }}>{words.detail}</Text>
        </View>
        {row.login !== null ? (
          <Button
            label="Disconnect"
            testID={`settings:account:${row.id}:disconnect`}
            onPress={() => void accounts.disconnect(manifest, row.id).then(changed)}
          />
        ) : step.kind === "ask" ? (
          <View style={{ flexDirection: "row", gap: 6 }}>
            <Button label="Cancel" testID={`settings:account:${row.id}:cancel`} onPress={() => setStep({ kind: "idle" })} />
            <Button label="Sign In" primary testID={`settings:account:${row.id}:sign-in`} onPress={signIn} />
          </View>
        ) : step.kind === "waiting" ? null : (
          <View style={{ flexDirection: "row", gap: 6 }}>
            <Button label="Paste a Token…" testID={`settings:account:${row.id}:paste`} onPress={() => setStep({ kind: "paste", token: "" })} />
            {canSignIn(provider) && (
              <Button label="Connect…" testID={`settings:account:${row.id}:connect`} onPress={() => (row.asked ? signIn() : setStep({ kind: "ask" }))} />
            )}
          </View>
        )}
      </View>
      {step.kind === "paste" && provider && (
        <TextField
          testID={`settings:account:${row.id}:token`}
          value={step.token}
          secure
          autoFocus
          placeholder={`${name} token, then Return`}
          onChangeText={(token) => setStep({ kind: "paste", token })}
          onSubmit={() => void accounts.paste(manifest, provider, step.token).then(done)}
          onKeyPress={(key) => {
            if (key === "Escape") setStep({ kind: "idle" });
          }}
        />
      )}
    </View>
  );
}
