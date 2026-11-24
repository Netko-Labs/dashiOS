/**
 * Settings › Keyboard › Clipboard: the history's switch (off deletes what
 * it kept), Clear history (confirmed in place), the apps whose copies are never kept (password
 * managers: privacy.ts DEFAULT_LEFT_OUT until the person changes the list),
 * and whether snippets expand in terminals. settings.json `clipboard`.
 */

import { SPACE, TextField } from "@dashi/ui";
import { View } from "@mirinjs/metal";
import { useState, useSyncExternalStore } from "react";
import type { ClipboardHistory, HistorySnapshot } from "../../../clipboard/history.ts";
import { DEFAULT_LEFT_OUT, leftOutApps, withoutApp } from "../../../clipboard/left-out.ts";
import { Caption, Group } from "../../../shared/cards/index.ts";
import { useSettings } from "../../hooks.ts";
import type { SettingsStore } from "../../store.ts";
import { Setting } from "../setting.tsx";
import { ConfirmDelete, ListRow, MiniButton } from "./parts.tsx";
import { AppDisc } from "./sound-mixer-parts.tsx";

/** What Settings reaches of the history: how much it holds, and clearing it. */
export type HistoryControl = Pick<ClipboardHistory, "subscribe" | "getSnapshot" | "clear">;

const EMPTY: HistorySnapshot = { entries: [], skipped: [] };
const none = () => () => {};

/** An app id or program name the list takes (what settings.json keeps). */
export const isAppEntry = (value: string): boolean => /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);

/** The installed app an id stands for: its name and icon (Settings' `installedApp`). */
export type InstalledApp = (id: string) => { name: string; icon: string } | undefined;

/** The field that adds one, and its Add, on a row of their own under the apps. */
const ADD_ROW = { gap: SPACE.m } as const;

/** The field that adds an app by its program's name, under the row's words. */
function AddLeftOut({ settings, list }: { settings: SettingsStore; list: readonly string[] }) {
  const [adding, setAdding] = useState("");
  const add = () => {
    const id = adding.trim();
    if (!isAppEntry(id) || list.includes(id)) return;
    settings.patch("clipboard", { leftOut: [...list, id] });
    setAdding("");
  };
  return (
    <View style={{ alignSelf: "stretch", flexDirection: "row", alignItems: "center", gap: ADD_ROW.gap }}>
      <TextField
        look="panel"
        testID="clipboard-left-out-add"
        value={adding}
        placeholder="Another app's program, like keepassxc"
        label="Leave out another app"
        onChangeText={setAdding}
        onSubmit={add}
      />
      <MiniButton testID="clipboard-left-out-add-button" label="Add" disabled={!isAppEntry(adding.trim())} onPress={add} />
    </View>
  );
}

/**
 * The apps whose copies are never kept: one ListRow each (its icon on the
 * knob, or its letter on a tint), Remove at the row's end (SE-11, SE-A43).
 */
function LeftOutRows({ settings, list, installed }: { settings: SettingsStore; list: readonly string[]; installed: InstalledApp }) {
  // One row per app, whatever ids the list keeps for it (KeePassXC's app id and program); Remove takes them all.
  return leftOutApps(list, installed).map((app) => {
    const icon = app.ids.map((id) => installed(id)?.icon).find((found) => found !== undefined);
    const key = app.ids[0] ?? app.name;
    return (
      <ListRow key={key} testID={`clipboard-left-out:${key}`} name={app.name} leading={<AppDisc icon={icon} name={app.name} />}>
        <MiniButton
          testID={`clipboard-left-out-remove:${key}`}
          label="Remove"
          onPress={() => settings.patch("clipboard", { leftOut: withoutApp(list, app) })}
        />
      </ListRow>
    );
  });
}

const NOT_INSTALLED: InstalledApp = () => undefined;

export function ClipboardSection({ settings, history, installed }: { settings: SettingsStore; history?: HistoryControl | null; installed?: InstalledApp }) {
  const { clipboard } = useSettings(settings).data;
  const snapshot = useSyncExternalStore(history?.subscribe ?? none, history?.getSnapshot ?? (() => EMPTY));
  const count = snapshot.entries.length;
  const leftOut = clipboard.leftOut ?? DEFAULT_LEFT_OUT;
  return (
    <>
      <Group testID="clipboard-settings">
        <Setting id="keyboard/clipboard-history" control="clipboard-history" />
        <Setting id="keyboard/clipboard-kept" detail={count === 0 ? "Nothing" : count === 1 ? "1 copy" : `${count} copies, pinned ones included`}>
          <ConfirmDelete testID="clipboard-clear" verb="Clear history" disabled={count === 0 || !history} onDelete={() => history?.clear()} />
        </Setting>
        <Setting id="keyboard/clipboard-left-out" below={<AddLeftOut settings={settings} list={leftOut} />} />
        <LeftOutRows settings={settings} list={leftOut} installed={installed ?? NOT_INSTALLED} />
        <Setting id="keyboard/snippets-in-terminals" control="snippets-in-terminals" />
      </Group>
      <Caption keys="⌥❖V">Type “snippet” in the launcher to add one. The history opens with</Caption>
    </>
  );
}
