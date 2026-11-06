/**
 * The portal's Access (org.freedesktop.impl.portal.Access): "Helium wants
 * to use the camera", as a sheet on the asking window, written as a
 * question, with the app's own reason under it. xdg-desktop-portal asks
 * this for the camera, the microphone, location and background running, and
 * remembers the answer itself (its permission store). An app with no window
 * gets an item in the menu bar that opens the sheet (ui/background.ts).
 *
 *   AccessDialog(o handle, s app_id, s parent_window, s title, s subtitle,
 *                s body, a{sv} options) → (u response, a{sv} results)
 *   options: modal b, deny_label s, grant_label s, icon s, choices a(ssa(ss)s)
 *   results: choices a(ss); response 0 granted, 1 denied
 */

import { AlertWindow, glyphs } from "@dashi/ui";
import { useState } from "react";
import type { InterfaceSpec } from "../../src/dbus/index.ts";
import { type AppInfo, appInfo } from "./apps.ts";
import { type Choice, parseChoices } from "./file-chooser/options.ts";
import { type Requests, Response, type ResponseCode } from "./request.ts";
import { CheckBox } from "./ui/frame.tsx";
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

/**
 * The line under the question when the app gave none. It names no Settings
 * pane: none lists these permissions yet (xdg-desktop-portal keeps them),
 * and copy points only at things that exist.
 */
export const accessFallback = (app: string): string => `Dashi remembers your answer, so ${app} won’t ask again.`;

function AccessSheet({ request, app, answer }: { request: AccessRequest; app: AppInfo; answer: (value: AccessAnswer | null) => void }) {
  const [choices, setChoices] = useState<Record<string, string>>(() => Object.fromEntries(request.choices.map((c) => [c.id, c.initial])));
  const reply = (granted: boolean) => answer({ granted, choices: Object.entries(choices) });
  const detail = [request.subtitle, request.body].filter(Boolean).join("\n\n") || accessFallback(app.name);
  const camera = /camera|video/i.test(`${request.icon ?? ""} ${request.title}`);
  // The choices it can draw: on-or-off ones, as check boxes.
  const boxes = request.choices.filter((choice) => choice.options.length === 0);
  return (
    // The one alert frame (UI-5): the question as the first line, no title row, the app's reason under it.
    <AlertWindow
      testID="portal"
      question={request.title}
      message={detail}
      glyph={camera ? CAMERA : glyphs.LOCK}
      tone="accent"
      buttons={[
        { label: request.denyLabel, testID: "access:deny", onPress: () => reply(false), cancel: true },
        // Allow is the one that goes ahead, but only a click gives access: Enter never does.
        { label: request.grantLabel, testID: "access:grant", onPress: () => reply(true), kind: "primary", isDefault: false },
      ]}
    >
      {boxes.length > 0
        ? boxes.map((choice) => (
            <CheckBox
              key={choice.id}
              testID={`access:choice:${choice.id}`}
              label={choice.label}
              checked={choices[choice.id] === "true"}
              onChange={(on) => setChoices({ ...choices, [choice.id]: on ? "true" : "false" })}
            />
          ))
        : undefined}
    </AlertWindow>
  );
}

/** The sheet on screen. */
export function askOnScreen(show: ShowDialog): AskAccess {
  return (request, signal) => {
    const app = appInfo(request.appId);
    return show<AccessAnswer | null>(
      { parent: request.parent, title: request.title, width: 440, height: 220 },
      (answer) => <AccessSheet request={request} app={app} answer={answer} />,
      signal,
      null,
    );
  };
}
