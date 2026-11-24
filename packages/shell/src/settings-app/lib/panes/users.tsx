/**
 * Users: the account type in the title ("Users · Administrator"), then the
 * first card (SE-A33: no hero): the full name, the login name, the picture
 * (beside its Change picture…), Change password…, and automatic login. The
 * name and picture are the account service's (the picture is chosen with the
 * desktop's file chooser, the way Wallpaper's photos are). Changing the password opens its
 * own sheet that holds the keyboard; it is not part of this window, so an
 * agent working in the window can neither see nor type into it. Automatic
 * login needs an administrator: polkit asks, on the shell's own sheet.
 */

import { Loading, Picture, SPACE, TextField, TYPE, useControlColors, WEIGHT } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { useEffect, useState } from "react";
import { useAccount } from "../../../accounts/index.ts";
import { type Account, initialsOf, nameProblem } from "../../../shared/accounts/index.ts";
import { Button, Group } from "../../../shared/cards/index.ts";
import type { PhotoChooser } from "../../../wallpaper/chooser.ts";
import type { PaneServices } from "../../services.ts";
import { Page, Switch } from "../../ui.tsx";
import { PAGE } from "../row.tsx";
import { Setting } from "../setting.tsx";
import { Failure, Value } from "./parts.tsx";
import { NO_CHOOSER } from "./wallpaper-live.tsx";

/** The picture at its row's end, a knob's size; the name's field. */
const AVATAR = PAGE.knob;
const NAME_FIELD = 200;

/** The account's picture, or its initials in ink on the knob's resting circle: an avatar is nobody's "on" (CO-2, SE-A2). */
function Avatar({ account }: { account: Account }) {
  const colors = useControlColors();
  // With no picture, or one the host cannot draw (a TIFF, an AVIF).
  const initials = <Text style={{ fontSize: TYPE.panel.name.size, fontWeight: WEIGHT.semibold, color: colors.text }}>{initialsOf(account)}</Text>;
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
        backgroundColor: colors.knobRest,
      }}
    >
      {account.iconFile !== null ? (
        <Picture source={account.iconFile} resizeMode="cover" style={{ width: AVATAR, height: AVATAR }} fallback={initials} />
      ) : (
        initials
      )}
    </View>
  );
}

function NameRow({ account, onSave, busy }: { account: Account; onSave: (name: string) => void; busy: boolean }) {
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
      <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.m }}>
        <TextField
          look="panel"
          testID="account-name"
          label="Full name"
          value={value}
          placeholder="Your name"
          width={NAME_FIELD}
          invalid={problem !== null}
          onChangeText={setTyped}
          onSubmit={save}
        />
        <Button testID="account-name-save" label="Save" primary disabled={!dirty || problem !== null || busy} onPress={save} />
      </View>
    </Setting>
  );
}

export function UsersPane({ services, chooser }: { services: PaneServices; chooser: PhotoChooser }) {
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
      .catch(() => store.fail("picture", NO_CHOOSER));
  };
  if (state.available === false) {
    return (
      <Page title="Users">
        <Failure testID="account-unavailable">Your account can't be read right now. Log out and in again, then open Users again.</Failure>
      </Page>
    );
  }
  if (account === null) {
    return (
      <Page title="Users">
        <Group>
          <View style={{ padding: PAGE.inset }}>
            <Loading testID="account-loading" />
          </View>
        </Group>
      </Page>
    );
  }
  const failure = state.failure;
  return (
    <Page title="Users" detail={account.administrator ? "Administrator" : "Standard account"}>
      <Group testID="account-details">
        <NameRow account={account} busy={state.busy !== null} onSave={(name) => void store.setRealName(name)} />
        <Setting id="users/account-name">
          <Value testID="account-login">{account.userName}</Value>
        </Setting>
        <Setting id="users/picture">
          <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.inset }}>
            <Avatar account={account} />
            <Button
              testID="account-picture"
              label={state.busy === "picture" ? "Changing…" : "Change picture…"}
              disabled={state.busy !== null}
              onPress={changePicture}
            />
          </View>
        </Setting>
      </Group>
      <Group testID="account-security">
        <Setting id="users/password">
          <Button testID="account-password" label="Change password…" onPress={() => services.changePassword(account.hasPassword)} />
        </Setting>
        <Setting id="users/automatic-login" detail={state.busy === "login" ? "Waiting for permission…" : undefined}>
          <Switch testID="account-autologin" on={account.automaticLogin} onChange={(on) => state.busy === null && void store.setAutomaticLogin(on)} />
        </Setting>
      </Group>
      {failure && <Failure testID="account-failure">{failure.message}</Failure>}
    </Page>
  );
}
