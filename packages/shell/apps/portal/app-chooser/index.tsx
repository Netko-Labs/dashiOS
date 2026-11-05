/**
 * The portal's AppChooser (org.freedesktop.impl.portal.AppChooser): Open
 * With, as a short list (choices.ts), with "Always use for …" and "Other…".
 *
 *   ChooseApplication(o handle, s app_id, s parent_window, as choices,
 *                     a{sv} options) → (u response, a{sv} results{choice s})
 *   UpdateChoices(o handle, as choices): the list changed while it showed
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { glyphs, useColors } from "@dashi/ui";
import { Image, ScrollView, Svg, Text, View } from "@mirinjs/metal";
import { useState, useSyncExternalStore } from "react";
import type { InterfaceSpec } from "../../../src/dbus/index.ts";
import { exec } from "../../files/exec.ts";
import { appInfo } from "../apps.ts";
import { handlePath, type Requests, Response, type ResponseCode } from "../request.ts";
import { CheckBox, PortalFrame } from "../ui/frame.tsx";
import { results } from "../vardict.ts";
import type { ShowDialog } from "../windows.ts";
import { type AppChooserRequest, alwaysUse, orderChoices, parseAppChooser, parseGioDefault, SHORT_LIST, subjectOf } from "./choices.ts";

export const APP_CHOOSER = "org.freedesktop.impl.portal.AppChooser";

export interface AppChoice {
  id: string;
  always: boolean;
}

/** The list a sheet shows, which UpdateChoices replaces. */
export class ChoiceList {
  private listeners = new Set<() => void>();
  constructor(private ids: readonly string[]) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = (): readonly string[] => this.ids;
  set(ids: readonly string[]): void {
    this.ids = ids;
    for (const listener of this.listeners) listener();
  }
}

export type ChooseApp = (request: AppChooserRequest, list: ChoiceList, signal: AbortSignal) => Promise<AppChoice | null>;

export function appChooserReply(choice: AppChoice | null, request: AppChooserRequest): [ResponseCode, Map<string, unknown>] {
  if (!choice) return [Response.cancelled, new Map()];
  return [Response.success, results({ choice: ["s", choice.id], activation_token: request.activationToken ? ["s", request.activationToken] : undefined })];
}

export function appChooserInterface(requests: Requests, choose: ChooseApp, defaultFor: (mime: string) => Promise<string | null>): InterfaceSpec {
  const open = new Map<string, { list: ChoiceList; request: AppChooserRequest; defaultId: string | null }>();
  return {
    name: APP_CHOOSER,
    methods: {
      ChooseApplication: {
        in: "ossasa{sv}",
        out: "ua{sv}",
        handler: ([handle, ...rest]) =>
          requests.run(handle, async (signal) => {
            const request = parseAppChooser(rest);
            const defaultId = request.contentType ? await defaultFor(request.contentType).catch(() => null) : null;
            const list = new ChoiceList(orderChoices(request, defaultId));
            const path = handlePath(handle);
            open.set(path, { list, request, defaultId });
            try {
              return appChooserReply(await choose(request, list, signal), request);
            } finally {
              open.delete(path);
            }
          }),
      },
      UpdateChoices: {
        in: "oas",
        handler: ([handle, choices]) => {
          const entry = open.get(String(handle));
          if (!entry) return;
          const request = { ...entry.request, choices: parseAppChooser(["", "", choices, new Map()]).choices };
          entry.list.set(orderChoices(request, entry.defaultId));
        },
      },
    },
    properties: { version: { type: "u", get: () => 2 } },
  };
}

/** The default app for a type, as `gio mime` says. */
export async function gioDefault(mime: string): Promise<string | null> {
  const outcome = await exec(["gio", "mime", mime]);
  return outcome.ok ? parseGioDefault(outcome.stdout) : null;
}

/** "Always use": the person's own mimeapps.list, written whole and moved into place. */
export function saveAlways(mime: string, id: string, home: string = homedir()): void {
  const path = join(process.env.XDG_CONFIG_HOME || join(home, ".config"), "mimeapps.list");
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    // No file yet.
  }
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, alwaysUse(text, mime, id));
  renameSync(temp, path);
}

function AppRow({ id, chosen, isDefault, onPress }: { id: string; chosen: boolean; isDefault: boolean; onPress: () => void }) {
  const colors = useColors();
  const app = appInfo(id);
  const ink = chosen ? "#ffffff" : colors.text;
  return (
    <View
      testID={`chooser:app:${id}`}
      onPress={onPress}
      style={{
        height: 34,
        flexShrink: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingHorizontal: 8,
        borderRadius: 7,
        backgroundColor: chosen ? colors.selection : "#00000000",
        hoverBackgroundColor: chosen ? colors.selection : colors.button,
      }}
    >
      {app.icon ? <Image source={app.icon} style={{ width: 22, height: 22 }} /> : <Svg markup={glyphs.INFO} size={18} color={ink} />}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 13, color: ink }}>
          {app.name}
        </Text>
      </View>
      {isDefault && <Text style={{ fontSize: 12, color: chosen ? "#ffffffcc" : colors.textMuted }}>default</Text>}
    </View>
  );
}

function AppChooserSheet({
  request,
  list,
  defaultId,
  answer,
}: {
  request: AppChooserRequest;
  list: ChoiceList;
  defaultId: string | null;
  answer: (value: AppChoice | null) => void;
}) {
  const colors = useColors();
  const ids = useSyncExternalStore(list.subscribe, list.getSnapshot);
  const [all, setAll] = useState(false);
  const [chosen, setChosen] = useState<string | null>(ids[0] ?? null);
  const [always, setAlways] = useState(false);
  const shown = all ? ids : ids.slice(0, SHORT_LIST);
  const subject = subjectOf(request);
  const pick = () => chosen && answer({ id: chosen, always });
  return (
    <PortalFrame
      title={`Open “${subject}” with`}
      onCancel={() => answer(null)}
      buttons={[
        { label: "Cancel", testID: "chooser:cancel", onPress: () => answer(null) },
        { label: "Open", testID: "chooser:open", onPress: pick, primary: true, disabled: chosen === null },
      ]}
      footer={
        request.contentType ? (
          <CheckBox testID="chooser:always" label={`Always use for ${request.contentType}`} checked={always} onChange={setAlways} />
        ) : undefined
      }
    >
      <ScrollView style={{ flex: 1, flexDirection: "column", gap: 2, minHeight: 0 }}>
        {shown.map((id) => (
          <AppRow
            key={id}
            id={id}
            chosen={chosen === id}
            isDefault={id === defaultId}
            onPress={() => (chosen === id ? answer({ id, always }) : setChosen(id))}
          />
        ))}
        {ids.length === 0 && <Text style={{ fontSize: 13, color: colors.textMuted }}>No app here opens this. Software may have one.</Text>}
        {!all && ids.length > SHORT_LIST && (
          <View testID="chooser:other" onPress={() => setAll(true)} style={{ height: 30, justifyContent: "center", paddingHorizontal: 8 }}>
            <Text style={{ fontSize: 13, color: colors.selection }}>Other…</Text>
          </View>
        )}
      </ScrollView>
    </PortalFrame>
  );
}

export function chooseOnScreen(show: ShowDialog, defaultFor: (mime: string) => Promise<string | null> = gioDefault): ChooseApp {
  return async (request, list, signal) => {
    const defaultId = request.contentType ? await defaultFor(request.contentType).catch(() => null) : null;
    const choice = await show<AppChoice | null>(
      { parent: request.parent, title: "Open With", width: 400, height: 320 },
      (answer) => <AppChooserSheet request={request} list={list} defaultId={defaultId} answer={answer} />,
      signal,
      null,
    );
    if (choice?.always && request.contentType) {
      try {
        saveAlways(request.contentType, choice.id);
      } catch (error) {
        console.error("dashi-portal: could not save the default app:", error instanceof Error ? error.message : error);
      }
    }
    return choice;
  };
}
