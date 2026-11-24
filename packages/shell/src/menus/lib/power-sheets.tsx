/**
 * Two small sheets from the Dashi and app menus: the question before a
 * restart, shut down, or log out, and the About window. Each is centered on
 * a surface with room around it for its shadow. And the notice naming the
 * app that holds a log out while it asks its own question.
 */

import { AlertSheet, Button, LOGO, Notice, RESTART, SHUT_DOWN, Sheet, SPACE, TYPE, useColors, WEIGHT } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import { holdingCopy } from "../../closing-apps.ts";
import { KeyCatcher } from "../../overlay.tsx";
import { AppIcon } from "../../shared/apps/index.ts";
import type { PowerKind } from "../types.ts";
import { HOLDING, type HoldingPlace } from "./holding-place.ts";

/** What each sheet asks (VO-10: what will happen, never "Are you sure"), its glyph, and the button that names the act. */
const COPY: Record<PowerKind, { question: string; button: string; glyph: string }> = {
  restart: { question: "Restart now?", button: "Restart", glyph: RESTART },
  shutdown: { question: "Shut down now?", button: "Shut down", glyph: SHUT_DOWN },
  logout: { question: "Log out now?", button: "Log out", glyph: LOGO },
};

const DETAIL = "Apps will be asked to close first. One with unsaved changes asks you.";

/** The About card's icon: an app's at 64, Dashi's mark at 56. */
const ABOUT_ICON = { app: 64, logo: 56 } as const;

/**
 * Esc cancels and Return presses the default button, the one that goes ahead (decisions.md D24):
 * going ahead loses nothing, since an app with unsaved changes asks first and the person can
 * still cancel there. The Return that chose the menu's row can't reach it: a held key does not
 * repeat into a surface that got the keyboard after it went down. The alert frame (UI-5),
 * centred on its own surface: the shell has no window to hang it from.
 */
export function ConfirmSheet({ what, onConfirm, onCancel }: { what: PowerKind; onConfirm: () => void; onCancel: () => void }) {
  const copy = COPY[what];
  return (
    <AlertSheet
      testID="sheet"
      place="screen"
      question={copy.question}
      message={DETAIL}
      glyph={copy.glyph}
      buttons={[
        { label: "Cancel", testID: "sheet-cancel", onPress: onCancel, cancel: true },
        { label: copy.button, testID: "sheet-confirm", onPress: onConfirm, kind: "primary" },
      ]}
    />
  );
}

/**
 * While an app holds a log out, restart, or shut down to ask its own question
 * (closing-apps.ts): a notice naming who it waits for, with Cancel and the
 * way to go anyway. It floats at a screen edge clear of the app's sheet
 * (holding-place.ts: the foot, or under the menu bar when the window is that
 * low), its card on the side of that edge, and leaves the keyboard to the
 * app; Esc cancels once it is clicked.
 */
export function HoldingNotice({
  what,
  names,
  edge,
  onCancel,
  onAnyway,
}: {
  what: PowerKind;
  names: readonly string[];
  edge: HoldingPlace["edge"];
  onCancel: () => void;
  onAnyway: () => void;
}) {
  const copy = holdingCopy(names, what);
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: edge === "bottom" ? "flex-end" : "flex-start",
        // The card sits at its edge; the shadow falls into the rest.
        padding: HOLDING.shadow,
        paddingTop: edge === "top" ? SPACE.m : HOLDING.shadow,
        paddingBottom: edge === "bottom" ? SPACE.m : HOLDING.shadow,
      }}
    >
      <KeyCatcher onKey={(key) => key === "Escape" && onCancel()} />
      <Notice
        testID="holding"
        text={copy.line}
        action={
          <View style={{ flexDirection: "row", gap: SPACE.m }}>
            <Button testID="holding-cancel" label="Cancel" onPress={onCancel} />
            <Button testID="holding-anyway" label={copy.anyway} onPress={onAnyway} />
          </View>
        }
      />
    </View>
  );
}

export interface AboutInfo {
  title: string;
  /** Lines under the title, muted. */
  lines: readonly string[];
  /** A full-color icon path; the Dashi logo when absent. */
  icon?: string;
}

/** About: an app's icon or Dashi's mark, its name as a page's title (TY-1), its lines, and OK, on the sheet card. */
export function AboutWindow({ info, onClose }: { info: AboutInfo; onClose: () => void }) {
  const colors = useColors();
  return (
    <Sheet testID="about" place="screen" onCancel={onClose} onConfirm={onClose}>
      <View style={{ flexDirection: "column", alignItems: "center", gap: SPACE.gap }}>
        {info.icon ? (
          <AppIcon source={info.icon} style={{ width: ABOUT_ICON.app, height: ABOUT_ICON.app }} />
        ) : (
          <Svg markup={LOGO} size={ABOUT_ICON.logo} color={colors.text} />
        )}
        <Text style={{ fontSize: TYPE.title.size, lineHeight: TYPE.title.line, fontWeight: WEIGHT.bold, color: colors.text, textAlign: "center" }}>
          {info.title}
        </Text>
        <View style={{ flexDirection: "column", alignItems: "center", gap: SPACE.xxs }}>
          {info.lines.map((line) => (
            <Text key={line} style={{ fontSize: TYPE.secondary.size, lineHeight: TYPE.secondary.line, color: colors.textMuted, textAlign: "center" }}>
              {line}
            </Text>
          ))}
        </View>
      </View>
      <View style={{ flexDirection: "row", justifyContent: "flex-end", marginTop: SPACE.s }}>
        <Button testID="about-ok" label="OK" primary onPress={onClose} />
      </View>
    </Sheet>
  );
}
