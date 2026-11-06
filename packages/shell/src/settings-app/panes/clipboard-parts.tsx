/**
 * Settings › Keyboard › Clipboard: the history's switch (off deletes what
 * it kept), Clear History, the apps whose copies are never kept (password
 * managers: privacy.ts DEFAULT_LEFT_OUT until the person changes the list),
 * and whether snippets expand in terminals. settings.json `clipboard`.
 */

import { Button, Switch, useColors } from "@dashi/ui";
import { Text, TextInput, View } from "@mirinjs/metal";
import { useState, useSyncExternalStore } from "react";
import type { ClipboardHistory, HistorySnapshot } from "../../clipboard/history.ts";
import { DEFAULT_LEFT_OUT, LEFT_OUT_NAMES } from "../../clipboard/privacy.ts";
import { useSettings } from "../hooks.ts";
import type { SettingsStore } from "../store.ts";
import { Caption, Group, Row, Spot, useSurface } from "../ui.tsx";

/** What Settings reaches of the history: how much it holds, and clearing it. */
export type HistoryControl = Pick<ClipboardHistory, "subscribe" | "getSnapshot" | "clear">;

const EMPTY: HistorySnapshot = { entries: [], skipped: [] };
const none = () => () => {};

/** An app id or program name the list takes (what settings.json keeps). */
export const isAppEntry = (value: string): boolean => /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);

function LeftOutList({ settings, list }: { settings: SettingsStore; list: readonly string[] }) {
  const colors = useColors();
  const surface = useSurface();
  const [adding, setAdding] = useState("");
  const add = () => {
    const id = adding.trim();
    if (!isAppEntry(id) || list.includes(id)) return;
    settings.patch("clipboard", { leftOut: [...list, id] });
    setAdding("");
  };
  return (
    <View style={{ flexDirection: "column", gap: 4 }}>
      {list.map((id) => (
        <View key={id} testID={`clipboard-left-out:${id}`} style={{ flexDirection: "row", alignItems: "center", gap: 8, height: 28 }}>
          <View style={{ flex: 1, minWidth: 0, flexDirection: "row", gap: 6 }}>
            <Text numberOfLines={1} style={{ fontSize: 12, color: colors.text }}>
              {LEFT_OUT_NAMES[id] ?? id}
            </Text>
            {LEFT_OUT_NAMES[id] && (
              <Text numberOfLines={1} style={{ fontSize: 11, color: colors.textMuted }}>
                {id}
              </Text>
            )}
          </View>
          <Button
            testID={`clipboard-left-out-remove:${id}`}
            label="Remove"
            onPress={() => settings.patch("clipboard", { leftOut: list.filter((each) => each !== id) })}
          />
        </View>
      ))}
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

export function ClipboardSection({ settings, history }: { settings: SettingsStore; history?: HistoryControl | null }) {
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
          <LeftOutList settings={settings} list={clipboard.leftOut ?? DEFAULT_LEFT_OUT} />
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
