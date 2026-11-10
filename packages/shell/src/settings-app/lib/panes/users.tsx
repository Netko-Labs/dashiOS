/**
 * Users: the current user's picture and full name, their login
 * name and account type, Change Password…, and automatic login. The name and
 * picture are AccountsService's (the picture is chosen with the desktop's file
 * chooser, the way Wallpaper's photos are). Changing the password opens its
 * own sheet that holds the keyboard; it is not part of this window, so an
 * agent working in the window can neither see nor type into it. Automatic
 * login needs an administrator: polkit asks, on the shell's own sheet.
 */

import { Image, Text, TextInput, View } from "@mirinjs/metal";
import { useEffect, useState } from "react";
import { type Account, initialsOf, nameProblem, useAccount } from "../../../accounts/index.ts";
import type { PhotoChooser } from "../../../wallpaper/chooser.ts";
import { useColors } from "../../colors.ts";
import type { PaneServices } from "../../services.ts";
import { Button, Caption, Group, Hero, Note, Page, Switch, useSurface } from "../../ui.tsx";
import { Setting } from "../setting.tsx";
import { Failure, Value } from "./parts.tsx";

const AVATAR = 72;

function Avatar({ account }: { account: Account }) {
  const colors = useColors();
  return (
    <View
      testID="account-avatar"
      style={{
        width: AVATAR,
        height: AVATAR,
        borderRadius: AVATAR / 2,
        overflow: "hidden",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: colors.selection,
      }}
    >
      {account.iconFile !== null ? (
        <Image source={account.iconFile} resizeMode="cover" style={{ width: AVATAR, height: AVATAR }} />
      ) : (
        <Text style={{ fontSize: 28, fontWeight: "semibold", color: "#ffffff" }}>{initialsOf(account)}</Text>
      )}
    </View>
  );
}

function NameRow({ account, onSave, busy }: { account: Account; onSave: (name: string) => void; busy: boolean }) {
  const colors = useColors();
  const surface = useSurface();
  // What is typed; null while the field shows the account's own name.
  const [typed, setTyped] = useState<string | null>(null);
  const value = typed ?? account.realName;
  const problem = typed === null ? null : nameProblem(typed);
  const dirty = typed !== null && typed.trim() !== account.realName;
  const save = () => {
    if (!dirty || problem !== null || busy) return;
    onSave(value);
    setTyped(null);
  };
  return (
    <Setting id="users/full-name" detail={problem ?? null}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={{ width: 200 }}>
          <TextInput
            testID="account-name"
            value={value}
            placeholder="Your name"
            onChangeText={setTyped}
            onSubmitEditing={save}
            style={{ width: "100%", fontSize: 13, padding: 8, borderRadius: 12, color: colors.text, backgroundColor: surface.field }}
          />
        </View>
        <Button testID="account-name-save" label="Save" primary disabled={!dirty || problem !== null || busy} onPress={save} />
      </View>
    </Setting>
  );
}

export function UsersPane({ services, chooser }: { services: PaneServices; chooser: PhotoChooser }) {
  const colors = useColors();
  const { account: store } = services;
  const state = useAccount(store);
  const { account } = state;
  useEffect(() => {
    void store.refresh();
  }, [store]);

  const changePicture = () => {
    store.dismissFailure();
    chooser
      .choose()
      .then((path) => path !== null && void store.setIcon(path))
      .catch(() => store.fail("picture", "There is no file chooser here."));
  };
  if (state.available === false) {
    return (
      <Page title="Users">
        <Group>
          <Note testID="account-unavailable">Your account can't be read: AccountsService isn't running or doesn't know this user.</Note>
        </Group>
      </Page>
    );
  }
  if (account === null) {
    return (
      <Page title="Users">
        <Group>
          <Note testID="account-loading">Loading…</Note>
        </Group>
      </Page>
    );
  }
  const failure = state.failure;
  return (
    <Page title="Users">
      <Hero testID="account-hero">
        <View style={{ flex: 1, flexDirection: "column", alignItems: "center", gap: 6, paddingVertical: 4 }}>
          <Avatar account={account} />
          <View testID="account-title">
            <Text style={{ fontSize: 18, fontWeight: "semibold", color: colors.text }}>{account.realName || account.userName}</Text>
          </View>
          <Text style={{ fontSize: 12, color: colors.textMuted }}>{account.administrator ? "Administrator" : "Standard"}</Text>
        </View>
      </Hero>
      <Group testID="account-details">
        <NameRow account={account} busy={state.busy !== null} onSave={(name) => void store.setRealName(name)} />
        <Setting id="users/account-name">
          <Value testID="account-login">{account.userName}</Value>
        </Setting>
        <Setting id="users/picture">
          <Button
            testID="account-picture"
            label={state.busy === "picture" ? "Changing…" : "Change Picture…"}
            disabled={state.busy !== null}
            onPress={changePicture}
          />
        </Setting>
      </Group>
      <Group testID="account-security">
        <Setting id="users/password">
          <Button testID="account-password" label="Change Password…" onPress={() => services.changePassword(account.hasPassword)} />
        </Setting>
        <Setting id="users/automatic-login" detail={state.busy === "login" ? "Waiting for permission…" : undefined}>
          <Switch testID="account-autologin" on={account.automaticLogin} onChange={(on) => state.busy === null && void store.setAutomaticLogin(on)} />
        </Setting>
      </Group>
      {failure && <Failure testID="account-failure">{failure.message}</Failure>}
      <Caption>Automatic login is honored by login managers that read AccountsService (GDM); SDDM and greetd are configured in their own files.</Caption>
    </Page>
  );
}
