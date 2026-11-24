/**
 * The portal's DynamicLauncher (org.freedesktop.impl.portal.DynamicLauncher):
 * a browser installing a web app. Dashi asks once, with the icon and a name
 * the person can change: "Add “YNAB” to the Dock?". On Add, xdg-desktop-portal
 * writes the launcher into ~/.local/share/applications, and the shell, told
 * here, pins it in the Dock when it appears (src/portal-host/launchers.ts).
 *
 *   PrepareInstall(o handle, s app_id, s parent_window, s name, v icon_v,
 *                  a{sv} options) → (u response, a{sv} results{name s, icon v})
 *   RequestInstallToken(s app_id, a{sv} options) → u
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AlertWindow, Picture, RADIUS, SPACE, TextField, TYPE, useColors } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { useState } from "react";
import { type InterfaceSpec, Variant } from "../../../src/shared/dbus/index.ts";
import { appInfo } from "./apps.ts";
import { parseIcon } from "./notification.ts";
import { type Requests, Response, type ResponseCode } from "./request.ts";
import { DOCK } from "./ui/glyphs.ts";
import { bool, cleanString, str, u32, vardict } from "./vardict.ts";
import type { ShowDialog } from "./windows.ts";

export const DYNAMIC_LAUNCHER = "org.freedesktop.impl.portal.DynamicLauncher";

export const LauncherType = { application: 1, webapp: 2 } as const;

export interface InstallRequest {
  appId: string;
  parent: string;
  name: string;
  icon: Variant | null;
  /** What the launcher opens: a web app's address. */
  target: string | null;
  kind: number;
  editableName: boolean;
}

export function parseInstall(args: readonly unknown[]): InstallRequest {
  const [appId, parent, name, icon, options] = args;
  const dict = vardict(options);
  return {
    appId: typeof appId === "string" ? cleanString(appId, 256) : "",
    parent: typeof parent === "string" ? cleanString(parent, 256) : "",
    name:
      typeof name === "string"
        ? cleanString(name, 128)
            .replace(/[\r\n]+/g, " ")
            .trim()
        : "",
    icon: icon instanceof Variant ? icon : null,
    target: str(dict, "target") ?? null,
    kind: u32(dict, "launcher_type") ?? LauncherType.application,
    editableName: bool(dict, "editable_name") !== false,
  };
}

/** A name a launcher may have: something, on one line, not too long. */
export const launcherName = (name: string): string | null => {
  const clean = name.replace(/[\u0000-\u001f\u007f\s]+/g, " ").trim();
  return clean === "" ? null : clean.slice(0, 128);
};

export function installReply(request: InstallRequest, name: string | null): [ResponseCode, Map<string, unknown>] {
  if (name === null) return [Response.cancelled, new Map()];
  const out = new Map<string, unknown>([["name", new Variant("s", name)]]);
  if (request.icon) out.set("icon", request.icon);
  return [Response.success, out];
}

/** Asks; the name chosen, or null for Cancel. */
export type AskInstall = (request: InstallRequest, signal: AbortSignal) => Promise<string | null>;

export function dynamicLauncherInterface(requests: Requests, ask: AskInstall, added: (appId: string, name: string) => void): InterfaceSpec {
  return {
    name: DYNAMIC_LAUNCHER,
    methods: {
      PrepareInstall: {
        in: "osssva{sv}",
        out: "ua{sv}",
        handler: ([handle, ...rest]) =>
          requests.run(handle, async (signal) => {
            const request = parseInstall(rest);
            const name = await ask(request, signal);
            if (name !== null) added(request.appId, name);
            return installReply(request, name);
          }),
      },
      // Installing without asking is for the store, which Dashi's Software does not do through the portal: always no.
      RequestInstallToken: { in: "sa{sv}", out: "u", handler: () => Response.other },
    },
    properties: {
      SupportedLauncherTypes: { type: "u", get: () => LauncherType.application | LauncherType.webapp },
      version: { type: "u", get: () => 1 },
    },
  };
}

/** The icon the app sent, as a file for the sheet; null for a themed one or none. Bytes the host cannot draw show as the empty tile. */
function iconPicture(icon: Variant | null): string | null {
  const parsed = parseIcon(icon ?? undefined);
  if (!parsed || !("bytes" in parsed)) return null;
  try {
    const dir = join(process.env.XDG_RUNTIME_DIR || "/tmp", "dashi-portal", "icons");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const path = join(dir, `launcher-${new Bun.CryptoHasher("sha256").update(parsed.bytes).digest("hex").slice(0, 24)}.png`);
    writeFileSync(path, parsed.bytes, { mode: 0o600 });
    return path;
  } catch {
    return null;
  }
}

function hostOf(target: string | null): string | null {
  if (!target) return null;
  try {
    return new URL(target).host || null;
  } catch {
    return null;
  }
}

/** The launcher's icon as the Dock will show it, and a name field's label column. */
const ADD = { icon: 48, label: 44, width: 440, height: 210 } as const;

/** "Add to Dock?": the one alert frame (UI-5), the launcher's icon and, when the site lets it be renamed, its name under the words. */
function AddToDock({ request, answer }: { request: InstallRequest; answer: (name: string | null) => void }) {
  const colors = useColors();
  const [name, setName] = useState(request.name);
  const browser = appInfo(request.appId).name;
  const host = hostOf(request.target);
  const picture = iconPicture(request.icon);
  // With no icon, a themed one, or bytes the host cannot draw.
  const tile = <View style={{ width: ADD.icon, height: ADD.icon, borderRadius: RADIUS.icon, backgroundColor: colors.button }} />;
  const chosen = launcherName(name);
  const add = () => chosen && answer(chosen);
  return (
    <AlertWindow
      testID="launcher"
      keys={!request.editableName}
      question={`Add “${chosen ?? request.name}” to the Dock?`}
      message={`${host ? `Opens ${host} in its own ${browser} window.` : `It opens in ${browser}.`} It shows in the Dock and the launcher, and is removed like any app.`}
      glyph={DOCK}
      tone="neutral"
      onCancel={() => answer(null)}
      buttons={[
        { label: "Cancel", testID: "launcher:cancel", onPress: () => answer(null), cancel: true },
        { label: "Add", testID: "launcher:add", onPress: add, kind: "primary", disabled: chosen === null },
      ]}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.inset }}>
        {picture ? <Picture source={picture} style={{ width: ADD.icon, height: ADD.icon, borderRadius: RADIUS.icon }} fallback={tile} /> : tile}
        {request.editableName && (
          <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: SPACE.m, minWidth: 0 }}>
            <View style={{ width: ADD.label }}>
              <Text style={{ fontSize: TYPE.body.size, color: colors.text }}>Name</Text>
            </View>
            <TextField
              testID="launcher:name"
              value={name}
              label="Name"
              autoFocus
              onChangeText={setName}
              onSubmit={add}
              onKeyPress={(key) => key === "Escape" && answer(null)}
            />
          </View>
        )}
      </View>
    </AlertWindow>
  );
}

export function askInstallOnScreen(show: ShowDialog): AskInstall {
  return (request, signal) =>
    show<string | null>(
      { parent: request.parent, title: "Add to Dock", width: ADD.width, height: ADD.height, least: { width: ADD.width, height: ADD.height } },
      (answer) => <AddToDock request={request} answer={answer} />,
      signal,
      null,
    );
}
