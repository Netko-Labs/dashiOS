/**
 * The sheet polkit's authentication agent shows: what wants to happen, who
 * will authenticate, a password field, Cancel and OK. It looks like the Wi-Fi
 * password sheet and, like it, holds the keyboard until answered; Enter
 * answers and Esc cancels (the input is what receives both, so it keeps the
 * focus through every phase).
 */

import { useColors } from "@dashi/ui";
import { Image, Svg, Text, TextInput, View } from "@mirinjs/metal";
import { useState } from "react";
import { Button, Panel, SHEET_SIZE } from "../../menus/sheets.tsx";
import { type DetailRow, HINT, type SheetActions, type SheetState, type SheetStore, useSheet } from "./model.ts";

/** A padlock, for requests that name no icon of their own. */
export const PADLOCK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect x="3" y="7" width="10" height="7.5" rx="1.6" fill="#000"/><path d="M5.2 7V5a2.8 2.8 0 0 1 5.6 0v2" stroke="#000" stroke-width="1.4" fill="none" stroke-linecap="round"/></svg>`;

/** Users offered as buttons; polkitd rarely lists more than a few. */
const MAX_PILLS = 4;
/** Characters of message that fit on a line of the sheet at its size, with room for words that wrap early. */
const LINE_CHARS = 32;
/** What a line of the message adds, and the rest of the sheet with room for its shadow (measured). */
const LINE_HEIGHT = 25;
const BASE_HEIGHT = 330;

/** The "Details" row, and for each detail row: a label line, and the value's lines at this many characters a line. */
const DETAILS_ROW = 20;
const DETAIL_VALUE_CHARS = 44;
const DETAIL_LINE = 15;
const DETAIL_LABEL = 14;
const DETAIL_GAP = 6;

/** What the open "Details" list adds to the panel. */
export function detailsHeight(rows: readonly DetailRow[]): number {
  return rows.reduce((sum, row) => sum + DETAIL_LABEL + DETAIL_LINE * Math.ceil(row.value.length / DETAIL_VALUE_CHARS) + DETAIL_GAP, 0);
}

/**
 * The overlay's size for a request: the panel grows a line for each line of
 * message (`MAX_MESSAGE` keeps that bounded). The surface cannot resize, so
 * it is made as tall as the panel gets with "Details" open; the panel stays
 * centered in it and the rest is empty.
 */
export function sheetSize(state: Pick<SheetState, "message" | "details">): { width: number; height: number } {
  const lines = Math.max(1, Math.ceil(state.message.length / LINE_CHARS));
  return { width: SHEET_SIZE.width + 2 * SHEET_SIZE.margin, height: BASE_HEIGHT + LINE_HEIGHT * lines + DETAILS_ROW + detailsHeight(state.details) };
}

/** A chevron: down when the list is open, right when it is closed. */
const chevron = (open: boolean) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="${open ? "M2 3.5 5 6.5 8 3.5" : "M3.5 2 6.5 5 3.5 8"}" stroke="#000" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

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

  // The line under the field keeps its height when empty, so the sheet does not jump.
  const status = state.phase === "checking" ? "Checking…" : (state.notice?.text ?? "");
  const hintColor = state.notice?.kind === "error" && state.phase !== "checking" ? colors.critical : colors.textMuted;
  return (
    <Panel>
      {state.icon ? <Image source={state.icon} style={{ width: 48, height: 48 }} /> : <Svg markup={PADLOCK} size={34} color={colors.text} />}
      {/* Stretched so the text is measured at the width it is drawn at; a shrink-wrapped one counts a line too few. */}
      <View style={{ alignSelf: "stretch" }}>
        <Text style={{ fontSize: 15, fontWeight: "bold", color: colors.text, textAlign: "center" }}>{state.message}</Text>
      </View>
      <Text style={{ fontSize: 12, color: colors.textMuted, textAlign: "center" }}>{HINT}</Text>
      {state.users.length > 1 ? (
        <View style={{ flexDirection: "row", justifyContent: "center", gap: 6 }}>
          {state.users.slice(0, MAX_PILLS).map((user) => (
            <View
              key={user.uid}
              testID={`polkit-user-${user.login}`}
              onPress={() => actions.pick(user.uid)}
              style={{
                height: 22,
                paddingLeft: 10,
                paddingRight: 10,
                justifyContent: "center",
                borderRadius: 11,
                backgroundColor: user.uid === state.user ? colors.selection : colors.button,
              }}
            >
              <Text style={{ fontSize: 12, color: user.uid === state.user ? "#ffffff" : colors.text }}>{user.label}</Text>
            </View>
          ))}
        </View>
      ) : (
        <View testID="polkit-user">
          <Text style={{ fontSize: 12, fontWeight: "semibold", color: colors.text }}>{current?.label ?? ""}</Text>
        </View>
      )}
      <View
        style={{
          alignSelf: "stretch",
          height: 30,
          justifyContent: "center",
          paddingLeft: 10,
          paddingRight: 10,
          borderRadius: 7,
          backgroundColor: colors.tile,
          borderWidth: 1,
          borderColor: state.notice?.kind === "error" ? colors.critical : colors.separator,
        }}
      >
        <TextInput
          testID="polkit-password"
          value={password}
          autoFocus
          secureTextEntry={!state.echo}
          placeholder={state.prompt}
          onChangeText={setPassword}
          onSubmitEditing={submit}
          onKeyPress={(key) => key === "Escape" && actions.cancel()}
          style={{ fontSize: 13, color: colors.text, placeholderColor: colors.textMuted, backgroundColor: "#00000000" }}
        />
      </View>
      <View testID="polkit-status" style={{ alignSelf: "stretch", height: 16 }}>
        {status !== "" && <Text style={{ fontSize: 12, color: hintColor }}>{status}</Text>}
      </View>
      <View
        testID="polkit-details-toggle"
        onPress={actions.toggleDetails}
        style={{ alignSelf: "stretch", height: DETAILS_ROW, flexDirection: "row", alignItems: "center", gap: 4 }}
      >
        <Svg markup={chevron(state.detailsOpen)} size={10} color={colors.textMuted} />
        <Text style={{ fontSize: 12, color: colors.textMuted }}>Details</Text>
      </View>
      {state.detailsOpen && (
        <View testID="polkit-details" style={{ alignSelf: "stretch", gap: DETAIL_GAP }}>
          {state.details.map((row) => (
            <View key={row.label} style={{ alignSelf: "stretch" }}>
              <Text style={{ fontSize: 11, color: colors.textMuted }}>{row.label}</Text>
              <Text style={{ fontSize: 12, color: colors.text }}>{row.value}</Text>
            </View>
          ))}
        </View>
      )}
      <View style={{ flexDirection: "row", alignSelf: "stretch", gap: 10, marginTop: 4 }}>
        <Button testID="polkit-cancel" label="Cancel" onPress={actions.cancel} />
        <Button testID="polkit-ok" label="OK" primary disabled={!canAnswer} onPress={submit} />
      </View>
    </Panel>
  );
}
