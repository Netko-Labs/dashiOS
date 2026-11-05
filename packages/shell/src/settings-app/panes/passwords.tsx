/**
 * Passwords: where logins come from (Dashi's vault, 1Password), where new
 * ones are saved, and the vault's logins, each with whether agents may ask to
 * use it. While this pane shows, agents' pictures blank the Settings window
 * (agents/secrets/vault-view.ts); a password typed here never leaves the
 * field but for dashi-secretd.
 */

import { Switch, useColors } from "@dashi/ui";
import { Text, TextInput, View } from "@mirinjs/metal";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { Passwords } from "../../agents/secrets/passwords.ts";
import type { AgentUse, LoginSummary } from "../../agents/secrets/vault.ts";
import { vaultShown } from "../../agents/secrets/vault-view.ts";
import { Button, Caption, Choices, Group, Note, Page, Row, useSurface } from "../ui.tsx";
import { Payments } from "./payments.tsx";

interface VaultView {
  status: { exists: boolean; unlocked: boolean; tpm: boolean | null } | null;
  logins: LoginSummary[];
  error: string | null;
}

function useVault(passwords: Passwords): [VaultView, () => void] {
  const [view, setView] = useState<VaultView>({ status: null, logins: [], error: null });
  const refresh = useCallback(() => {
    void (async () => {
      try {
        const status = await passwords.vault.status();
        const logins = status.unlocked ? await passwords.vault.logins() : [];
        setView({ status, logins, error: null });
      } catch (error) {
        setView({ status: null, logins: [], error: error instanceof Error ? error.message : String(error) });
      }
    })();
  }, [passwords]);
  useEffect(() => refresh(), [refresh]);
  return [view, refresh];
}

function Field({
  testID,
  value,
  placeholder,
  secure,
  onChange,
}: {
  testID: string;
  value: string;
  placeholder: string;
  secure?: boolean;
  onChange: (text: string) => void;
}) {
  const colors = useColors();
  const surface = useSurface();
  return (
    <View style={{ width: 220 }}>
      <TextInput
        testID={testID}
        value={value}
        placeholder={placeholder}
        secureTextEntry={secure === true}
        onChangeText={onChange}
        style={{ width: "100%", fontSize: 13, padding: 7, borderRadius: 7, color: colors.text, backgroundColor: surface.field }}
      />
    </View>
  );
}

function AddLogin({ passwords, onSaved }: { passwords: Passwords; onSaved: () => void }) {
  const empty = { site: "", account: "", password: "", totp: "" };
  const [form, setForm] = useState(empty);
  const [problem, setProblem] = useState<string | null>(null);
  const set = (key: keyof typeof empty) => (text: string) => setForm((current) => ({ ...current, [key]: text }));
  const save = () => {
    void passwords
      .save({ site: form.site, account: form.account, password: form.password, ...(form.totp ? { totp: form.totp } : {}) })
      .then(() => {
        setForm(empty);
        setProblem(null);
        onSaved();
      })
      .catch((error: unknown) => setProblem(error instanceof Error ? error.message : String(error)));
  };
  return (
    <Group testID="passwords-add">
      <Row label="Site">
        <Field testID="passwords-add-site" value={form.site} placeholder="github.com" onChange={set("site")} />
      </Row>
      <Row label="Account">
        <Field testID="passwords-add-account" value={form.account} placeholder="User name or email" onChange={set("account")} />
      </Row>
      <Row label="Password">
        <Field testID="passwords-add-password" value={form.password} placeholder="Password" secure onChange={set("password")} />
      </Row>
      <Row label="Two-factor secret" detail={problem ?? "Optional: the setup key, or an otpauth:// address"}>
        <Field testID="passwords-add-totp" value={form.totp} placeholder="Setup key" secure onChange={set("totp")} />
      </Row>
      <Row label="">
        <Button testID="passwords-add-save" label="Save Login" primary disabled={!form.site || !form.account || !form.password} onPress={save} />
      </Row>
    </Group>
  );
}

function LoginRow({ login, onAgents, onDelete }: { login: LoginSummary; onAgents: (agents: AgentUse) => void; onDelete: () => void }) {
  return (
    <Row label={login.site} detail={`${login.account}${login.hasCode ? " · two-factor code" : ""}`} testID={`login:${login.id}`}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Choices
          testID={`login-agents:${login.id}`}
          value={login.agents}
          options={[
            { value: "ask", label: "Ask" },
            { value: "never", label: "Never" },
          ]}
          onChange={onAgents}
        />
        <Button testID={`login-delete:${login.id}`} label="Delete" danger onPress={onDelete} />
      </View>
    </Row>
  );
}

export function PasswordsPane({ passwords }: { passwords: Passwords }) {
  // Agents' pictures blank this window while the pane shows.
  useEffect(() => vaultShown(), []);
  const prefs = useSyncExternalStore(passwords.prefs.subscribe, passwords.prefs.getSnapshot);
  const [vault, refresh] = useVault(passwords);
  const colors = useColors();
  const { status } = vault;
  const vaultLine = vault.error
    ? `Dashi's vault isn't running (${vault.error}).`
    : !status
      ? "Looking…"
      : !status.unlocked
        ? "Dashi's vault is locked: it opens when you log in."
        : status.tpm
          ? "Encrypted with your login password and this computer's security chip (TPM)."
          : "Encrypted with your login password.";
  return (
    <Page title="Passwords">
      <Group testID="passwords-sources">
        <Row label="Dashi" detail="Passkeys, app secrets, tokens, logins">
          <Switch
            testID="passwords-source-dashi"
            on={prefs.sources.dashi}
            onChange={(on) => passwords.prefs.set({ sources: { ...prefs.sources, dashi: on } })}
          />
        </Row>
        <Row
          label="1Password"
          detail={
            passwords.onePasswordReady() ? "Logins, codes and cards from your vault" : "Needs the 1Password app and its CLI (op), with CLI integration on"
          }
        >
          <Switch
            testID="passwords-source-1password"
            on={prefs.sources["1password"]}
            onChange={(on) => passwords.prefs.set({ sources: { ...prefs.sources, "1password": on } })}
          />
        </Row>
      </Group>
      <Group>
        <Row label="Save new logins to">
          <Choices
            testID="passwords-save-to"
            value={prefs.saveTo}
            options={[
              { value: "dashi", label: "Dashi" },
              { value: "1password", label: "1Password" },
            ]}
            onChange={(saveTo) => passwords.prefs.set({ saveTo })}
          />
        </Row>
      </Group>
      <Caption>
        Agents sign in and enter codes through Dashi, which types them: an agent never sees a password or a code, and each use is asked about on screen.
      </Caption>
      <Text style={{ fontSize: 13, fontWeight: "semibold", color: colors.text }}>Logins in Dashi</Text>
      <Group testID="passwords-logins">
        {vault.logins.length === 0 ? (
          <Note testID="passwords-none">{status?.unlocked ? "No logins yet. Add one below." : vaultLine}</Note>
        ) : (
          vault.logins.map((login) => (
            <LoginRow
              key={login.id}
              login={login}
              onAgents={(agents) => void passwords.vault.setAgents(login.id, agents).then(refresh)}
              onDelete={() => void passwords.vault.remove(login.id).then(refresh)}
            />
          ))
        )}
      </Group>
      {((status?.unlocked && prefs.saveTo === "dashi") || (prefs.saveTo === "1password" && passwords.onePasswordReady())) && (
        <AddLogin passwords={passwords} onSaved={refresh} />
      )}
      {prefs.saveTo === "1password" && <Caption>New logins are saved in 1Password (its app asks you to unlock it); its logins aren't listed here.</Caption>}
      <Caption>{vaultLine}</Caption>
      {status?.unlocked && <Payments vault={passwords.vault} />}
    </Page>
  );
}
