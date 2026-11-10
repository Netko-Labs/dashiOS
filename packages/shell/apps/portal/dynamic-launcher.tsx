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
import { TextField, useColors } from "@dashi/ui";
import { Image, Text, View } from "@mirinjs/metal";
import { useState } from "react";
import { type InterfaceSpec, Variant } from "../../src/shared/dbus/index.ts";
import { appInfo } from "./apps.ts";
import { parseIcon } from "./notification.ts";
import { type Requests, Response, type ResponseCode } from "./request.ts";
import { PortalFrame } from "./ui/frame.tsx";
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

/** The icon the app sent, as a file the sheet can draw; null for a themed one or none. */
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

function InstallSheet({ request, answer }: { request: InstallRequest; answer: (name: string | null) => void }) {
  const colors = useColors();
  const [name, setName] = useState(request.name);
  const browser = appInfo(request.appId).name;
  const host = hostOf(request.target);
  const picture = iconPicture(request.icon);
  const chosen = launcherName(name);
  const add = () => chosen && answer(chosen);
  return (
    <PortalFrame
      title="Add to Dock"
      keys={!request.editableName}
      onCancel={() => answer(null)}
      buttons={[
        { label: "Cancel", testID: "launcher:cancel", onPress: () => answer(null) },
        { label: "Add", testID: "launcher:add", onPress: add, primary: true, disabled: chosen === null },
      ]}
    >
      <View style={{ flexDirection: "row", gap: 14, alignItems: "flex-start" }}>
        {picture ? (
          <Image source={picture} style={{ width: 48, height: 48, borderRadius: 11 }} />
        ) : (
          <View style={{ width: 48, height: 48, borderRadius: 11, backgroundColor: colors.button }} />
        )}
        <View style={{ flex: 1, flexDirection: "column", gap: 6, minWidth: 0 }}>
          <Text style={{ fontSize: 13, fontWeight: "bold", color: colors.text }}>{`Add “${chosen ?? request.name}” to the Dock?`}</Text>
          <Text style={{ fontSize: 12, color: colors.textMuted }}>
            {`${host ? `Opens ${host} in its own ${browser} window.` : `It opens in ${browser}.`} It shows in the Dock and the launcher, and is removed like any app.`}
          </Text>
          {request.editableName && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text style={{ fontSize: 13, color: colors.text }}>Name</Text>
              <TextField
                testID="launcher:name"
                value={name}
                autoFocus
                onChangeText={setName}
                onSubmit={add}
                onKeyPress={(key) => key === "Escape" && answer(null)}
              />
            </View>
          )}
        </View>
      </View>
    </PortalFrame>
  );
}

export function askInstallOnScreen(show: ShowDialog): AskInstall {
  return (request, signal) =>
    show<string | null>(
      { parent: request.parent, title: "Add to Dock", width: 440, height: 210 },
      (answer) => <InstallSheet request={request} answer={answer} />,
      signal,
      null,
    );
}
