/**
 * The Force Quit Applications window, drawn the way the Mac draws it: a glass
 * panel with the title, the apps with windows (icon, name, and a count when
 * an app has several), a note, and a Force Quit button. Choosing Force Quit
 * asks in the same panel. Esc closes (or backs out of the question).
 */

import { buttonLook, rowLook, SelectionBar, useColors } from "@dashi/ui";
import { Image, Text, View } from "@mirinjs/metal";
import { useSyncExternalStore } from "react";
import { KeyCatcher, type NavigationKey } from "../../overlay.tsx";
import type { AppGroup } from "../types.ts";
import type { ForceQuitController, ForceQuitState } from "./controller.ts";
import { VISIBLE_ROWS } from "./model.ts";

/** The window's size; the panel is inset by a margin for its shadow. */
export const FORCE_QUIT = { width: 400, height: 404, margin: 24 } as const;

const PANEL_WIDTH = FORCE_QUIT.width - FORCE_QUIT.margin * 2;
const ROW_HEIGHT = 32;
/** Muted ink for a button that cannot be pressed. */

function Button({ label, primary, disabled, testID, onPress }: { label: string; primary?: boolean; disabled?: boolean; testID: string; onPress: () => void }) {
  const colors = useColors();
  const look = buttonLook(colors, "primary");
  return (
    <View
      testID={testID}
      onPress={disabled ? undefined : onPress}
      style={{
        minWidth: 112,
        height: 28,
        paddingHorizontal: 14,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 7,
        backgroundColor: primary && !disabled ? look.fill : colors.button,
        hoverBackgroundColor: primary && !disabled ? look.hover : colors.button,
      }}
    >
      <Text
        style={{
          fontSize: 13,
          fontWeight: primary && !disabled ? "semibold" : "normal",
          color: disabled ? colors.textDisabled : primary ? look.ink : colors.text,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

function Row({ group, selected, onPress }: { group: AppGroup; selected: boolean; onPress: () => void }) {
  const colors = useColors();
  const look = rowLook(colors, selected);
  return (
    <View
      testID={`force-quit-row:${group.name}`}
      onPress={onPress}
      style={{
        height: ROW_HEIGHT,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingLeft: 8,
        paddingRight: 10,
        borderRadius: 6,
        backgroundColor: look.ground,
      }}
    >
      {selected && <SelectionBar rowHeight={ROW_HEIGHT} />}
      <Image source={group.icon} style={{ width: 22, height: 22 }} />
      <Text numberOfLines={1} style={{ fontSize: 13, color: look.ink }}>
        {group.name}
      </Text>
      {group.detail !== "" ? (
        <View style={{ flexShrink: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: 11, color: look.quiet }}>
            {group.detail}
          </Text>
        </View>
      ) : (
        group.windowCount > 1 && <Text style={{ fontSize: 11, color: look.quiet }}>{`${group.windowCount} windows`}</Text>
      )}
    </View>
  );
}

/** The list: the rows on screen, or a line saying there are none. */
function AppList({ state, onSelect }: { state: ForceQuitState; onSelect: (pid: number) => void }) {
  const colors = useColors();
  const visible = state.groups.slice(state.top, state.top + VISIBLE_ROWS);
  return (
    <View
      style={{
        alignSelf: "stretch",
        height: VISIBLE_ROWS * ROW_HEIGHT + 8,
        padding: 4,
        justifyContent: state.groups.length === 0 ? "center" : "flex-start",
        borderRadius: 8,
        backgroundColor: colors.tile,
        borderWidth: 1,
        borderColor: colors.separator,
      }}
    >
      {state.loaded && state.groups.length === 0 && <Text style={{ fontSize: 13, color: colors.textMuted, textAlign: "center" }}>No apps are open.</Text>}
      {visible.map((group) => (
        <Row key={group.pid} group={group} selected={group.pid === state.selected} onPress={() => onSelect(group.pid)} />
      ))}
    </View>
  );
}

/** The question, in the same panel: what Force Quit will do, and the buttons. */
function Question({ group, onCancel, onConfirm }: { group: AppGroup; onCancel: () => void; onConfirm: () => void }) {
  const colors = useColors();
  return (
    <>
      <Image source={group.icon} style={{ width: 48, height: 48 }} />
      <Text style={{ fontSize: 15, fontWeight: "bold", color: colors.text, textAlign: "center" }}>{`Do you want to force “${group.name}” to quit?`}</Text>
      <Text style={{ fontSize: 12, color: colors.textMuted, textAlign: "center" }}>You will lose any unsaved changes.</Text>
      <View style={{ flexDirection: "row", justifyContent: "flex-end", alignSelf: "stretch", gap: 10, marginTop: 6 }}>
        <Button testID="force-quit-cancel" label="Cancel" onPress={onCancel} />
        <Button testID="force-quit-confirm" label="Force Quit" primary onPress={onConfirm} />
      </View>
    </>
  );
}

export function ForceQuitWindow({ controller }: { controller: ForceQuitController }) {
  const colors = useColors();
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const asking = state.groups.find((group) => group.pid === state.asking) ?? null;
  const selected = state.groups.find((group) => group.pid === state.selected) ?? null;
  const onKey = (key: NavigationKey) => {
    if (key === "Escape") controller.escape();
    else controller.move(key === "ArrowDown" ? "down" : "up");
  };
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <KeyCatcher onKey={onKey} onSubmit={() => controller.submit()} />
      <View
        occlude
        style={{
          width: PANEL_WIDTH,
          flexDirection: "column",
          alignItems: "center",
          gap: 10,
          padding: 20,
          borderRadius: 16,
          backgroundColor: colors.menu,
          borderWidth: 1,
          borderColor: colors.dockBorder,
          shadow: "xl",
        }}
      >
        <Text style={{ fontSize: 15, fontWeight: "bold", color: colors.text }}>Force Quit Applications</Text>
        {asking ? (
          <Question group={asking} onCancel={() => controller.cancel()} onConfirm={() => void controller.confirm()} />
        ) : (
          <>
            <AppList state={state} onSelect={(pid) => controller.select(pid)} />
            <Text style={{ fontSize: 12, color: colors.textMuted, textAlign: "center" }}>
              If an app doesn't respond for a while, select its name and click Force Quit.
            </Text>
            <View style={{ flexDirection: "row", justifyContent: "flex-end", alignSelf: "stretch", marginTop: 4 }}>
              <Button testID="force-quit-button" label="Force Quit" primary disabled={selected === null} onPress={() => controller.ask()} />
            </View>
          </>
        )}
      </View>
    </View>
  );
}
