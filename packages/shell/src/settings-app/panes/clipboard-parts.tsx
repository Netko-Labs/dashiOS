/**
 * Settings › Keyboard › Clipboard: the history's switch (off deletes what
 * it kept), Clear History, the apps whose copies are never kept (password
 * managers: privacy.ts DEFAULT_LEFT_OUT until the person changes the list),
 * and whether snippets expand in terminals. settings.json `clipboard`.
 */

import { Button, Switch, useColors } from "@dashi/ui";
import { Image, Text, TextInput, View } from "@mirinjs/metal";
import { useState, useSyncExternalStore } from "react";
import { iconPath } from "../../apps.ts";
import type { ClipboardHistory, HistorySnapshot } from "../../clipboard/history.ts";
import { DEFAULT_LEFT_OUT, leftOutApps, withoutApp } from "../../clipboard/privacy.ts";
import { useSettings } from "../hooks.ts";
import type { SettingsStore } from "../store.ts";
import { Caption, Group, Row, Spot, useSurface } from "../ui.tsx";

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
  const on = clipboard.history !== false;
  const count = snapshot.entries.length;
  return (
    <>
      <Group testID="clipboard-settings">
        <Spot pane="keyboard" row="clipboard-history">
          <Row
            label="Keep clipboard history"
            detail="Copies to paste again from the launcher: 200 at most, for 7 days, on this computer only. Turned off, what was kept is deleted."
          >
            <Switch testID="clipboard-history" on={on} onChange={(next) => settings.patch("clipboard", { history: next ? undefined : false })} />
          </Row>
        </Spot>
        <Row label="Kept now" detail={count === 0 ? "Nothing" : count === 1 ? "1 copy" : `${count} copies, pinned ones included`}>
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
        </Row>
        <Row stack label="Never kept from these apps" detail="Password fields, copies marked secret, and Dashi's Passwords are never kept either.">
          <LeftOutList settings={settings} list={clipboard.leftOut ?? DEFAULT_LEFT_OUT} installed={installed ?? NOT_INSTALLED} />
        </Row>
        <Spot pane="keyboard" row="snippets-in-terminals">
          <Row label="Snippets in terminals" detail="A snippet's keyword expands in terminals too. Never in password fields.">
            <Switch
              testID="snippets-in-terminals"
              on={clipboard.snippetsInTerminals === true}
              onChange={(next) => settings.patch("clipboard", { snippetsInTerminals: next ? true : undefined })}
            />
          </Row>
        </Spot>
      </Group>
      <Caption keys="⌥❖V">Type “snippet” in the launcher to add one. The history opens with</Caption>
    </>
  );
}
