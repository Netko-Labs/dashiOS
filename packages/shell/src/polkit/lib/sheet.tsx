/**
 * The sheet polkit's authentication agent shows: what wants to happen, who
 * will authenticate, a password field, Cancel and OK. The alert frame (UI-5)
 * on its own surface, like the Wi-Fi password sheet, and like it holds the
 * keyboard until answered; Enter answers and Esc cancels (the field takes
 * both while it has the keyboard, the sheet's keys otherwise).
 */

import { ALERT_TILE, AlertSheet, LOCK, MoreButton, Segmented, SPACE, TextField, TYPE, useColors, WEIGHT } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { useState } from "react";
import { sheetSurfaceWidth } from "../../menus/sheets.tsx";
import { AppIcon } from "../../shared/apps/index.ts";
import { type DetailRow, HINT, type SheetActions, type SheetState, type SheetStore, useSheet } from "./model.ts";

/** Users offered to choose from; polkitd rarely lists more than a few. */
const MAX_USERS = 4;
/** Characters of the question that fit on a line beside the tile, with room for words that wrap early. */
const LINE_CHARS = 36;
/** The rest of the sheet with room for its shadow, and what a line of the question adds (measured). */
const BASE_HEIGHT = 300;
const LINE_HEIGHT = TYPE.body.line;

/** For each detail row: a label line, and the value's lines at this many characters a line. */
const DETAIL_VALUE_CHARS = 44;
const DETAIL_GAP = SPACE.s;

/** What the open "Details" list adds to the sheet. */
export function detailsHeight(rows: readonly DetailRow[]): number {
  return rows.reduce((sum, row) => sum + TYPE.caption.line + TYPE.secondary.line * Math.ceil(row.value.length / DETAIL_VALUE_CHARS) + DETAIL_GAP, 0);
}

/**
 * The overlay's size for a request: the sheet grows a line for each line of
 * the question (`MAX_MESSAGE` keeps that bounded). The surface cannot resize,
 * so it is made as tall as the sheet gets with "Details" open; the sheet stays
 * centred in it and the rest is empty.
 */
export function sheetSize(state: Pick<SheetState, "message" | "details">): { width: number; height: number } {
  const lines = Math.max(1, Math.ceil(state.message.length / LINE_CHARS));
  return { width: sheetSurfaceWidth(), height: BASE_HEIGHT + LINE_HEIGHT * lines + detailsHeight(state.details) };
}

/** Who to authenticate as, when more than one person may: one of a few (R3). */
function Users({ users, chosen, onPick }: { users: SheetState["users"]; chosen: SheetState["user"]; onPick: SheetActions["pick"] }) {
  const shown = users.slice(0, MAX_USERS);
  return (
    <Segmented
      testID="polkit-users"
      options={shown.map((user) => ({ value: user.uid, label: user.label }))}
      value={chosen ?? shown[0]?.uid ?? 0}
      onChange={onPick}
    />
  );
}

function Details({ rows }: { rows: SheetState["details"] }) {
  const colors = useColors();
  return (
    <View testID="polkit-details" style={{ flexDirection: "column", gap: DETAIL_GAP }}>
      {rows.map((row) => (
        <View key={row.label} style={{ flexDirection: "column" }}>
          <Text style={{ fontSize: TYPE.caption.size, lineHeight: TYPE.caption.line, color: colors.textMuted }}>{row.label}</Text>
          <Text style={{ fontSize: TYPE.secondary.size, lineHeight: TYPE.secondary.line, color: colors.text }}>{row.value}</Text>
        </View>
      ))}
    </View>
  );
}

export function PolkitSheet({ store, actions }: { store: SheetStore; actions: SheetActions }) {
  const colors = useColors();
  const state = useSheet(store);
  const [password, setPassword] = useState("");
  const canAnswer = state.phase === "prompt" && password !== "";
  const current = state.users.find((user) => user.uid === state.user);

  const submit = () => {
    if (!canAnswer) return;
    actions.submit(password);
    setPassword("");
  };

  // The line under the field keeps its place when there is nothing to say, so the sheet does not jump.
  const status = state.phase === "checking" ? "Checking…" : (state.notice?.text ?? " ");
  const failed = state.notice?.kind === "error" && state.phase !== "checking";
  return (
    <AlertSheet
      testID="polkit-sheet"
      place="screen"
      question={state.message}
      message={HINT}
      glyph={LOCK}
      {...(state.icon ? { icon: <AppIcon source={state.icon} style={{ width: ALERT_TILE.size, height: ALERT_TILE.size }} /> } : {})}
      buttons={[
        { label: "Cancel", testID: "polkit-cancel", onPress: actions.cancel, cancel: true },
        { label: "OK", testID: "polkit-ok", onPress: submit, kind: "primary", disabled: !canAnswer },
      ]}
    >
      {state.users.length > 1 ? (
        <Users users={state.users} chosen={state.user} onPick={actions.pick} />
      ) : (
        <View testID="polkit-user">
          <Text style={{ fontSize: TYPE.secondary.size, lineHeight: TYPE.secondary.line, fontWeight: WEIGHT.semibold, color: colors.text }}>
            {current?.label ?? ""}
          </Text>
        </View>
      )}
      <TextField
        testID="polkit-password"
        value={password}
        autoFocus
        secure={!state.echo}
        placeholder={state.prompt}
        onChangeText={setPassword}
        onSubmit={submit}
        onKeyPress={(key) => key === "Escape" && actions.cancel()}
        message={status}
        invalid={failed}
      />
      <MoreButton testID="polkit-details-toggle" open={state.detailsOpen} more="Details" less="Hide details" onPress={actions.toggleDetails} />
      {state.detailsOpen && <Details rows={state.details} />}
    </AlertSheet>
  );
}
