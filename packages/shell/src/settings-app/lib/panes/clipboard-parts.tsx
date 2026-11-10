/**
 * Settings › Keyboard › Clipboard: the history's switch (off deletes what
 * it kept), Clear History, the apps whose copies are never kept (password
 * managers: privacy.ts DEFAULT_LEFT_OUT until the person changes the list),
 * and whether snippets expand in terminals. settings.json `clipboard`.
 */

import { Image, Text, TextInput, View } from "@mirinjs/metal";
import { useState, useSyncExternalStore } from "react";
import type { ClipboardHistory, HistorySnapshot } from "../../../clipboard/history.ts";
import { DEFAULT_LEFT_OUT, leftOutApps, withoutApp } from "../../../clipboard/privacy.ts";
import { iconPath } from "../../../shared/apps/index.ts";
import { useColors } from "../../colors.ts";
import { useSettings } from "../../hooks.ts";
import type { SettingsStore } from "../../store.ts";
import { Button, Caption, Group, useSurface } from "../../ui.tsx";
import { Setting } from "../setting.tsx";

/** What Settings reaches of the history: how much it holds, and clearing it. */
export type HistoryControl = Pick<ClipboardHistory, "subscribe" | "getSnapshot" | "clear">;

const EMPTY: HistorySnapshot = { entries: [], skipped: [] };
const none = () => () => {};

/** An app id or program name the list takes (what settings.json keeps). */
export const isAppEntry = (value: string): boolean => /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);

/** The installed app an id stands for: its name and icon (Settings' `installedApp`). */
export type InstalledApp = (id: string) => { name: string; icon: string } | undefined;

const APP_ICON = 20;
const GENERIC_ICON = iconPath("generic");

function LeftOutList({ settings, list, installed }: { settings: SettingsStore; list: readonly string[]; installed: InstalledApp }) {
  const colors = useColors();
  const surface = useSurface();
  const [adding, setAdding] = useState("");
  const add = () => {
    const id = adding.trim();
    if (!isAppEntry(id) || list.includes(id)) return;
    settings.patch("clipboard", { leftOut: [...list, id] });
    setAdding("");
  };
  // One row per app, whatever ids the list keeps for it (KeePassXC's app id and program); Remove takes them all.
  const apps = leftOutApps(list, installed);
  return (
    <View style={{ flexDirection: "column", gap: 4 }}>
      {apps.map((app) => {
        const icon = app.ids.map((id) => installed(id)?.icon).find((found) => found !== undefined) ?? GENERIC_ICON;
        const key = app.ids[0] ?? app.name;
        return (
          <View key={key} testID={`clipboard-left-out:${key}`} style={{ flexDirection: "row", alignItems: "center", gap: 8, height: 28 }}>
            <Image source={icon} style={{ width: APP_ICON, height: APP_ICON }} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontSize: 12, color: colors.text }}>
                {app.name}
              </Text>
            </View>
            <Button
              testID={`clipboard-left-out-remove:${key}`}
              label="Remove"
              onPress={() => settings.patch("clipboard", { leftOut: withoutApp(list, app) })}
            />
          </View>
        );
      })}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={{ flex: 1, height: 28, justifyContent: "center", paddingHorizontal: 8, borderRadius: 8, backgroundColor: surface.field }}>
          <TextInput
            testID="clipboard-left-out-add"
            value={adding}
            placeholder="An app id or program, like org.keepassxc.KeePassXC"
            onChangeText={setAdding}
            onSubmitEditing={add}
            style={{ flex: 1, fontSize: 12, color: colors.text, placeholderColor: colors.textMuted, backgroundColor: "#00000000" }}
          />
        </View>
        <Button testID="clipboard-left-out-add-button" label="Add" disabled={!isAppEntry(adding.trim())} onPress={add} />
      </View>
    </View>
  );
}

const NOT_INSTALLED: InstalledApp = () => undefined;

export function ClipboardSection({ settings, history, installed }: { settings: SettingsStore; history?: HistoryControl | null; installed?: InstalledApp }) {
  const { clipboard } = useSettings(settings).data;
  const snapshot = useSyncExternalStore(history?.subscribe ?? none, history?.getSnapshot ?? (() => EMPTY));
  const [asking, setAsking] = useState(false);
  const count = snapshot.entries.length;
  return (
    <>
      <Group testID="clipboard-settings">
        <Setting id="keyboard/clipboard-history" control="clipboard-history" />
        <Setting id="keyboard/clipboard-kept" detail={count === 0 ? "Nothing" : count === 1 ? "1 copy" : `${count} copies, pinned ones included`}>
          <Button
            testID="clipboard-clear"
            label={asking ? "Clear All?" : "Clear History"}
            danger={asking}
            disabled={count === 0 || !history}
            onPress={() => {
              if (!asking) return setAsking(true);
              history?.clear();
              setAsking(false);
            }}
          />
        </Setting>
        <Setting id="keyboard/clipboard-left-out">
          <LeftOutList settings={settings} list={clipboard.leftOut ?? DEFAULT_LEFT_OUT} installed={installed ?? NOT_INSTALLED} />
        </Setting>
        <Setting id="keyboard/snippets-in-terminals" control="snippets-in-terminals" />
      </Group>
      <Caption keys="⌥❖V">Type “snippet” in the launcher to add one. The history opens with</Caption>
    </>
  );
}
