/**
 * The Force Quit window: a form sheet (UI-15) on its own surface with the
 * apps that have windows (icon, name, and a count when an app has several),
 * a note, and Force Quit. Choosing Force Quit asks in the same place, on the
 * alert frame (UI-5): Force Quit there is ume (it loses unsaved work) and
 * Cancel is the default, so Enter cancels. Esc closes (or backs out of the
 * question); ↑ and ↓ choose an app.
 */

import { ALERT_TILE, AlertSheet, FormSheet, type KeyInput, KeySink, PICK_ROW, RADIUS, rowLook, SelectionBar, SPACE, TYPE, useColors } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { useSyncExternalStore } from "react";
import { AppIcon } from "../../shared/apps/index.ts";
import type { AppGroup } from "../types.ts";
import type { ForceQuitController, ForceQuitState } from "./controller.ts";
import { VISIBLE_ROWS } from "./model.ts";

/** The window's size; the sheet is inset by a margin for its shadow. */
export const FORCE_QUIT = { width: 400, height: 404, margin: 24 } as const;

const SHEET_WIDTH = FORCE_QUIT.width - FORCE_QUIT.margin * 2;
const ROW_HEIGHT = PICK_ROW.height;
/** An app's icon in its row. */
const ROW_ICON = 22;

function Row({ group, selected, onPress }: { group: AppGroup; selected: boolean; onPress: () => void }) {
  const colors = useColors();
  const look = rowLook(colors, selected);
  return (
    <View
      testID={`force-quit-row:${group.name}`}
      accessibilityRole="option"
      accessibilityLabel={group.name}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        height: ROW_HEIGHT,
        flexShrink: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: SPACE.m,
        paddingLeft: SPACE.m,
        paddingRight: SPACE.gap,
        borderRadius: RADIUS.control,
        backgroundColor: look.ground,
        hoverBackgroundColor: look.hover,
      }}
    >
      {selected && <SelectionBar rowHeight={ROW_HEIGHT} />}
      <AppIcon source={group.icon} style={{ width: ROW_ICON, height: ROW_ICON }} />
      <Text numberOfLines={1} style={{ fontSize: TYPE.body.size, color: look.ink }}>
        {group.name}
      </Text>
      {group.detail !== "" ? (
        <View style={{ flexShrink: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: TYPE.caption.size, color: look.quiet }}>
            {group.detail}
          </Text>
        </View>
      ) : (
        group.windowCount > 1 && <Text style={{ fontSize: TYPE.caption.size, color: look.quiet }}>{`${group.windowCount} windows`}</Text>
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
      testID="force-quit-list"
      accessibilityRole="listbox"
      style={{
        height: VISIBLE_ROWS * (ROW_HEIGHT + SPACE.px) + 2 * SPACE.xs,
        padding: SPACE.xs,
        gap: SPACE.px,
        justifyContent: state.groups.length === 0 ? "center" : "flex-start",
        borderRadius: RADIUS.card,
        borderWidth: 1,
        borderColor: colors.separator,
      }}
    >
      {state.loaded && state.groups.length === 0 && (
        <Text style={{ fontSize: TYPE.body.size, color: colors.textMuted, textAlign: "center" }}>No apps are open.</Text>
      )}
      {visible.map((group) => (
        <Row key={group.pid} group={group} selected={group.pid === state.selected} onPress={() => onSelect(group.pid)} />
      ))}
    </View>
  );
}

export function ForceQuitWindow({ controller }: { controller: ForceQuitController }) {
  const colors = useColors();
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const asking = state.groups.find((group) => group.pid === state.asking) ?? null;
  const selected = state.groups.find((group) => group.pid === state.selected) ?? null;
  const onKey = (key: KeyInput) => {
    if (key.kind === "escape") controller.escape();
    else if (key.kind === "enter") controller.submit();
    else if (key.kind === "up" || key.kind === "down") controller.move(key.kind);
  };
  const keys = <KeySink testID="force-quit-keys" onKey={onKey} />;
  if (asking) {
    return (
      <AlertSheet
        testID="force-quit-question"
        place="screen"
        keys={false}
        width={SHEET_WIDTH}
        question={`Force “${asking.name}” to quit?`}
        message="Its unsaved changes will be lost."
        glyph=""
        icon={<AppIcon source={asking.icon} style={{ width: ALERT_TILE.size, height: ALERT_TILE.size }} />}
        buttons={[
          { label: "Cancel", testID: "force-quit-cancel", onPress: () => controller.cancel(), cancel: true, isDefault: true },
          { label: "Force Quit", testID: "force-quit-confirm", onPress: () => void controller.confirm(), kind: "danger" },
        ]}
      >
        {keys}
      </AlertSheet>
    );
  }
  return (
    <FormSheet
      testID="force-quit"
      place="screen"
      keys={false}
      width={SHEET_WIDTH}
      title="Force quit an app"
      buttons={[{ label: "Force Quit", testID: "force-quit-button", onPress: () => controller.ask(), kind: "primary", disabled: selected === null }]}
    >
      {keys}
      <AppList state={state} onSelect={(pid) => controller.select(pid)} />
      <Text style={{ fontSize: TYPE.secondary.size, lineHeight: TYPE.secondary.line, color: colors.textMuted }}>
        If an app doesn’t respond for a while, choose it and press Force Quit.
      </Text>
    </FormSheet>
  );
}
