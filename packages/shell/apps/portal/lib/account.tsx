/**
 * The portal's Account (org.freedesktop.impl.portal.Account): an app asks
 * for the person's name and picture. A sheet shows exactly what it would get
 * (the name, the user name, the picture from Users & Accounts, through
 * src/accounts/) and the reason it gave; Share sends it, Don't Share nothing.
 *
 *   GetUserInformation(o handle, s app_id, s window, a{sv} options{reason s})
 *     → (u response, a{sv} results{id s, name s, image s})
 */

import { AlertWindow, Avatar, alertWindowHeight, useColors } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import type { Account } from "../../../src/shared/accounts/index.ts";
import type { InterfaceSpec } from "../../../src/shared/dbus/index.ts";
import { fileUri } from "../../../src/shared/files/index.ts";
import { appInfo } from "./apps.ts";
import { type Requests, Response, type ResponseCode } from "./request.ts";
import { PERSON } from "./ui/glyphs.ts";
import { cleanString, results, str, vardict } from "./vardict.ts";
import type { ShowDialog } from "./windows.ts";

export const ACCOUNT = "org.freedesktop.impl.portal.Account";

export interface AccountRequest {
  appId: string;
  parent: string;
  reason: string;
}

export function parseAccountRequest(args: readonly unknown[]): AccountRequest {
  const [appId, parent, options] = args;
  return {
    appId: typeof appId === "string" ? cleanString(appId, 256) : "",
    parent: typeof parent === "string" ? cleanString(parent, 256) : "",
    reason: str(vardict(options), "reason") ?? "",
  };
}

/** What sharing sends: the user name, the full name (the user name when there is none), the picture as a file URI. */
export function accountReply(account: Account | null, shared: boolean): [ResponseCode, Map<string, unknown>] {
  if (!account) return [Response.other, new Map()];
  if (!shared) return [Response.cancelled, new Map()];
  return [
    Response.success,
    results({
      id: ["s", account.userName],
      name: ["s", account.realName || account.userName],
      image: ["s", account.iconFile ? fileUri(account.iconFile) : ""],
    }),
  ];
}

export type AskShare = (request: AccountRequest, account: Account, signal: AbortSignal) => Promise<boolean>;

export function accountInterface(requests: Requests, read: () => Promise<Account | null>, ask: AskShare): InterfaceSpec {
  return {
    name: ACCOUNT,
    methods: {
      GetUserInformation: {
        in: "ossa{sv}",
        out: "ua{sv}",
        handler: ([handle, ...rest]) =>
          requests.run(handle, async (signal) => {
            const request = parseAccountRequest(rest);
            const account = await read().catch(() => null);
            if (!account) return accountReply(null, false);
            return accountReply(account, await ask(request, account, signal));
          }),
      },
    },
  };
}

const shareQuestion = (request: AccountRequest): string => `Share your name and picture with ${appInfo(request.appId).name}?`;
const shareReason = (request: AccountRequest): string | undefined => (request.reason !== "" ? `“${request.reason}”` : undefined);
/** The card of what would be shared: the 44 px picture and 10 around it. */
const SHARE_CARD = 64;
const SHARE_WIDTH = 420;

function AccountSheet({ request, account, answer }: { request: AccountRequest; account: Account; answer: (shared: boolean) => void }) {
  const colors = useColors();
  const name = account.realName || account.userName;
  const reason = shareReason(request);
  return (
    // The one alert frame (UI-5): the question first, then what would be shared, then the app's reason.
    <AlertWindow
      testID="portal"
      question={shareQuestion(request)}
      {...(reason !== undefined ? { message: reason } : {})}
      glyph={PERSON}
      tone="accent"
      buttons={[
        { label: "Don’t Share", testID: "account:deny", onPress: () => answer(false), cancel: true },
        // Sharing is a click, never a stray Enter.
        { label: "Share", testID: "account:share", onPress: () => answer(true), kind: "primary", isDefault: false },
      ]}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 10, borderRadius: 10, backgroundColor: colors.button }}>
        <Avatar name={name} {...(account.iconFile ? { picture: account.iconFile } : {})} size={44} />
        <View style={{ flexDirection: "column", gap: 2, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: "semibold", color: colors.text }}>
            {name}
          </Text>
          <Text numberOfLines={1} style={{ fontSize: 12, color: colors.textMuted }}>
            {account.userName}
          </Text>
        </View>
      </View>
    </AlertWindow>
  );
}

export function askShareOnScreen(show: ShowDialog): AskShare {
  return (request, account, signal) =>
    show<boolean>(
      {
        parent: request.parent,
        title: "Share Your Name",
        width: SHARE_WIDTH,
        // As tall as its question, the reason, the card and the buttons (vertical space is sacred).
        height: alertWindowHeight({ question: shareQuestion(request), message: shareReason(request) ?? "", extra: SHARE_CARD }, SHARE_WIDTH),
      },
      (answer) => <AccountSheet request={request} account={account} answer={answer} />,
      signal,
      false,
    );
}
