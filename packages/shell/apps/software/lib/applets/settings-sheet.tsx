/**
 * An extension's Settings… (store-v2 frame S5), from its Installed row: its
 * accounts (settings-account.tsx), its preferences as Dashi keeps them (words,
 * switches, a choice; a secret only as "kept in your keyring", with Change…
 * and Forget), its commands, and what it can reach, in the consent sheet's
 * words. What changes here is read by the extension the next time one of its
 * commands opens.
 */

import { appletDataRoot, describePermission, type InstalledApplet, type Manifest, type Preference, type PreferenceValue } from "@dashi/applet";
import { Button, Choices, Group, Row, Sheet, Switch, TextField, useColors } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { useEffect, useMemo, useState } from "react";
import { ExtensionAccounts, PreferenceStore } from "../../../../src/shared/extension-settings/index.ts";
import { AccountSetting } from "./settings-account.tsx";

const SHEET_WIDTH = 520;

function PreferenceSetting({
  manifest,
  preference,
  value,
  keep,
}: {
  manifest: Manifest;
  preference: Preference;
  value: PreferenceValue | undefined;
  keep: (value: PreferenceValue) => void;
}) {
  const colors = useColors();
  const [typed, setTyped] = useState<string | null>(null);
  const id = `settings:pref:${preference.name}`;
  if (preference.type === "checkbox") return <Switch testID={id} on={value === true} onChange={keep} />;
  if (preference.type === "dropdown")
    return (
      <Choices
        testID={id}
        options={(preference.options ?? []).map((option) => ({ value: option.value, label: option.title }))}
        value={typeof value === "string" ? value : ""}
        onChange={keep}
      />
    );
  if (preference.type === "secret" && typed === null)
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Text style={{ fontSize: 11, color: colors.textMuted }}>{value ? "Kept in your keyring" : "Not set"}</Text>
        <Button label={value ? "Change…" : "Set…"} testID={`${id}:change`} onPress={() => setTyped("")} />
        {value !== undefined && <Button label="Forget" testID={`${id}:forget`} onPress={() => keep("")} />}
      </View>
    );
  const shown = typed ?? (typeof value === "string" ? value : "");
  return (
    <TextField
      testID={id}
      width={220}
      value={shown}
      secure={preference.type === "secret"}
      placeholder={preference.description ?? `${manifest.name}: ${preference.title}`}
      onChangeText={setTyped}
      onSubmit={() => {
        keep(shown.trim());
        setTyped(null);
      }}
    />
  );
}

/** The sheet for one installed extension; `onClose` when it is done. */
export function ExtensionSettingsSheet({ applet, openUrl, onClose }: { applet: InstalledApplet; openUrl: (url: string) => void; onClose: () => void }) {
  const colors = useColors();
  const { manifest } = applet;
  const [round, setRound] = useState(0);
  const store = useMemo(() => new PreferenceStore(appletDataRoot()), []);
  const accounts = useMemo(() => new ExtensionAccounts(appletDataRoot()), []);
  const [values, setValues] = useState<Record<string, PreferenceValue>>({});
  // biome-ignore lint/correctness/useExhaustiveDependencies: read again after each change (`round`)
  useEffect(() => {
    void store.read(manifest).then(setValues);
  }, [store, manifest, round]);
  const changed = (): void => setRound((n) => n + 1);
  const rows = accounts.rows(manifest);
  const commands = manifest.commands.map((command) => command.title);
  const reach = manifest.permissions.map(describePermission);
  return (
    <Sheet testID="extension-settings" width={SHEET_WIDTH} onCancel={onClose}>
      <View style={{ flexDirection: "column", gap: 1 }}>
        <Text style={{ fontSize: 13, fontWeight: "bold", color: colors.text }}>{manifest.name}</Text>
        <Text style={{ fontSize: 11, color: colors.textMuted }}>{`Settings · version ${manifest.version}`}</Text>
      </View>
      <Group testID="extension-settings:rows">
        {rows.map((row) => (
          <Row key={row.id} label="Account" testID={`settings:account:${row.id}`} stack>
            <AccountSetting manifest={manifest} row={row} accounts={accounts} open={openUrl} changed={changed} />
          </Row>
        ))}
        {manifest.preferences.map((preference) => (
          <Row
            key={preference.name}
            label={preference.title}
            {...(preference.description ? { detail: preference.description } : {})}
            testID={`settings:${preference.name}`}
          >
            <PreferenceSetting
              manifest={manifest}
              preference={preference}
              value={values[preference.name]}
              keep={(value) => void store.write(manifest, preference.name, value).then(changed)}
            />
          </Row>
        ))}
        {commands.length > 0 && <Row label="Commands" detail={commands.join(" · ")} testID="settings:commands" />}
        <Row label="It can" detail={reach.length > 0 ? reach.join(" · ") : "Nothing beyond its own folder"} testID="settings:reach" wraps />
      </Group>
      <View style={{ flexDirection: "row", justifyContent: "flex-end", marginTop: 4 }}>
        <Button label="Done" testID="extension-settings:done" primary onPress={onClose} />
      </View>
    </Sheet>
  );
}

/** Whether an installed extension has anything for Settings…: an account or a preference. */
export const hasSettings = (applet: InstalledApplet): boolean =>
  applet.manifest.preferences.length > 0 || applet.manifest.permissions.some((each) => each.kind === "account");
