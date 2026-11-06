/**
 * The portal's Access (org.freedesktop.impl.portal.Access): "Helium wants
 * to use the camera", as a sheet on the asking window, written as a
 * question, with the app's own reason under it. xdg-desktop-portal asks
 * this for the camera, the microphone, location and background running, and
 * remembers the answer itself (its permission store), which Settings ›
 * Privacy & Security lists and takes back one by one; the sheet's button
 * opens it there. An app with no window gets an item in the menu bar that
 * opens the sheet (ui/background.ts).
 *
 *   AccessDialog(o handle, s app_id, s parent_window, s title, s subtitle,
 *                s body, a{sv} options) → (u response, a{sv} results)
 *   options: modal b, deny_label s, grant_label s, icon s, choices a(ssa(ss)s)
 *   results: choices a(ss); response 0 granted, 1 denied
 */

import { Button, glyphs, useColors } from "@dashi/ui";
import { Svg, View } from "@mirinjs/metal";
import { useState } from "react";
import { type LinkAnswer, openLink } from "../../src/actions/open-link.ts";
import type { InterfaceSpec } from "../../src/dbus/index.ts";
import { paneTitle } from "../../src/settings-app/panes.ts";
import { type AppInfo, appInfo } from "./apps.ts";
import { type Choice, parseChoices } from "./file-chooser/options.ts";
import { type Requests, Response, type ResponseCode } from "./request.ts";
import { CheckBox, PortalFrame, Question } from "./ui/frame.tsx";
import { CAMERA } from "./ui/glyphs.ts";
import { cleanString, results, str, vardict } from "./vardict.ts";
import type { ShowDialog } from "./windows.ts";

export const ACCESS = "org.freedesktop.impl.portal.Access";

export interface AccessRequest {
  appId: string;
  parent: string;
  title: string;
  subtitle: string;
  body: string;
  grantLabel: string;
  denyLabel: string;
  /** An icon name the portal suggests (camera-web-symbolic); the sheet draws its own glyph. */
  icon: string | null;
  choices: Choice[];
}

export interface AccessAnswer {
  granted: boolean;
  choices: Array<[string, string]>;
}

const text = (value: unknown, max = 1024): string => (typeof value === "string" ? cleanString(value, max) : "");

export function parseAccess(args: readonly unknown[]): AccessRequest {
  const [appId, parent, title, subtitle, body, options] = args;
  const dict = vardict(options);
  return {
    appId: text(appId, 256),
    parent: text(parent, 256),
    title: text(title) || "Allow access?",
    subtitle: text(subtitle),
    body: text(body),
    grantLabel: str(dict, "grant_label")?.replace(/_/g, "") || "Allow",
    denyLabel: str(dict, "deny_label")?.replace(/_/g, "") || "Don’t Allow",
    icon: str(dict, "icon") ?? null,
    choices: parseChoices(dict),
  };
}

export function accessReply(answer: AccessAnswer | null): [ResponseCode, Map<string, unknown>] {
  if (!answer) return [Response.cancelled, new Map()];
  return [answer.granted ? Response.success : Response.cancelled, results({ choices: answer.choices.length > 0 ? ["a(ss)", answer.choices] : undefined })];
}

export type AskAccess = (request: AccessRequest, signal: AbortSignal) => Promise<AccessAnswer | null>;

export function accessInterface(requests: Requests, ask: AskAccess): InterfaceSpec {
  return {
    name: ACCESS,
    methods: {
      AccessDialog: {
        in: "osssssa{sv}",
        out: "ua{sv}",
        handler: ([handle, ...rest]) => requests.run(handle, async (signal) => accessReply(await ask(parseAccess(rest), signal))),
      },
    },
  };
}

/** The line under the question when the app gave none. */
export const accessFallback = (app: string): string => `Dashi remembers your answer, so ${app} won’t ask again.`;

/** Where the person reviews and takes back what they answered: the pane's name comes from the pane list (CP-7). */
export const PRIVACY_LINK = "dashi://settings/privacy/apps";
export const privacyLabel = (): string => `${paneTitle("privacy")}…`;

/** Opens a `dashi://` link in the session (the shell's links socket). */
export type OpenLink = (url: string) => Promise<LinkAnswer>;

function AccessSheet({ request, app, answer, open }: { request: AccessRequest; app: AppInfo; answer: (value: AccessAnswer | null) => void; open: OpenLink }) {
  const colors = useColors();
  const [choices, setChoices] = useState<Record<string, string>>(() => Object.fromEntries(request.choices.map((c) => [c.id, c.initial])));
  const reply = (granted: boolean) => answer({ granted, choices: Object.entries(choices) });
  const detail = [request.subtitle, request.body].filter(Boolean).join("\n\n") || accessFallback(app.name);
  const camera = /camera|video/i.test(`${request.icon ?? ""} ${request.title}`);
  return (
    <PortalFrame
      title={app.name}
      onCancel={() => reply(false)}
      footer={<Button testID="access:privacy" label={privacyLabel()} onPress={() => void open(PRIVACY_LINK)} />}
      buttons={[
        { label: request.denyLabel, testID: "access:deny", onPress: () => reply(false) },
        // Allow is the one that goes ahead, but only a click gives access: Enter never does.
        { label: request.grantLabel, testID: "access:grant", onPress: () => reply(true), primary: true, grants: true },
      ]}
    >
      <Question
        text={request.title}
        detail={detail}
        glyph={
          <View style={{ width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: `${colors.selection}24` }}>
            <Svg markup={camera ? CAMERA : glyphs.LOCK} size={22} color={colors.selection} />
          </View>
        }
      />
      {request.choices.map((choice) =>
        choice.options.length === 0 ? (
          <CheckBox
            key={choice.id}
            testID={`access:choice:${choice.id}`}
            label={choice.label}
            checked={choices[choice.id] === "true"}
            onChange={(on) => setChoices({ ...choices, [choice.id]: on ? "true" : "false" })}
          />
        ) : null,
      )}
    </PortalFrame>
  );
}

/** The sheet on screen. */
export function askOnScreen(show: ShowDialog, open: OpenLink = (url) => openLink(url)): AskAccess {
  return (request, signal) => {
    const app = appInfo(request.appId);
    return show<AccessAnswer | null>(
      { parent: request.parent, title: request.title, width: 440, height: 220 },
      (answer) => <AccessSheet request={request} app={app} answer={answer} open={open} />,
      signal,
      null,
    );
  };
}
