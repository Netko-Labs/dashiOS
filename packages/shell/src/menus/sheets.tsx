/**
 * Two small sheets from the Dashi and app menus: the question before a
 * restart, shut down, or log out, and the About window. Each is centered on
 * a surface with room around it for its shadow. And the notice naming the
 * app that holds a log out while it asks its own question.
 */

import { Notice, Button as UiButton, useColors } from "@dashi/ui";
import { Image, Svg, Text, View } from "@mirinjs/metal";
import type { ReactNode } from "react";
import { holdingCopy } from "../closing-apps.ts";
import { LOGO } from "../glyphs.ts";
import { KeyCatcher } from "../overlay.tsx";
import { HOLDING, type HoldingPlace } from "./holding-place.ts";
import type { PowerKind } from "./model.ts";

/** Panel size, and the margin the shadow needs on each side. */
export const SHEET_SIZE = { width: 340, margin: 28 } as const;

const COPY: Record<PowerKind, { question: string; detail: string; button: string }> = {
  restart: {
    question: "Are you sure you want to restart your computer now?",
    detail: "Apps will be asked to close first. One with unsaved changes asks you.",
    button: "Restart",
  },
  shutdown: {
    question: "Are you sure you want to shut down your computer now?",
    detail: "Apps will be asked to close first. One with unsaved changes asks you.",
    button: "Shut Down",
  },
  logout: {
    question: "Are you sure you want to log out now?",
    detail: "Apps will be asked to close first. One with unsaved changes asks you.",
    button: "Log Out",
  },
};

export function Panel({ children }: { children: ReactNode }) {
  const colors = useColors();
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <View
        occlude
        style={{
          width: SHEET_SIZE.width,
          flexDirection: "column",
          alignItems: "center",
          gap: 10,
          padding: 22,
          borderRadius: 16,
          backgroundColor: colors.menu,
          borderWidth: 1,
          borderColor: colors.dockBorder,
          shadow: "xl",
        }}
      >
        {children}
      </View>
    </View>
  );
}

export function Button({
  label,
  primary,
  disabled,
  testID,
  onPress,
}: {
  label: string;
  primary?: boolean;
  /** Dimmed and deaf to presses. */
  disabled?: boolean;
  testID: string;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <View
      testID={testID}
      onPress={disabled ? undefined : onPress}
      style={{
        flex: 1,
        height: 28,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 7,
        backgroundColor: primary ? colors.selection : colors.button,
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <Text style={{ fontSize: 13, fontWeight: primary ? "semibold" : "normal", color: primary ? "#ffffff" : colors.text }}>{label}</Text>
    </View>
  );
}

/** Esc cancels; Enter does not confirm, so a stray key cannot shut the machine down. */
export function ConfirmSheet({ what, onConfirm, onCancel }: { what: PowerKind; onConfirm: () => void; onCancel: () => void }) {
  const colors = useColors();
  const copy = COPY[what];
  return (
    <Panel>
      <KeyCatcher onKey={(key) => key === "Escape" && onCancel()} />
      <Svg markup={LOGO} size={34} color={colors.text} />
      <Text style={{ fontSize: 15, fontWeight: "bold", color: colors.text, textAlign: "center" }}>{copy.question}</Text>
      <Text style={{ fontSize: 12, color: colors.textMuted, textAlign: "center" }}>{copy.detail}</Text>
      <View style={{ flexDirection: "row", alignSelf: "stretch", gap: 10, marginTop: 6 }}>
        <Button testID="sheet-cancel" label="Cancel" onPress={onCancel} />
        <Button testID="sheet-confirm" label={copy.button} primary onPress={onConfirm} />
      </View>
    </Panel>
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
        paddingTop: edge === "top" ? 8 : HOLDING.shadow,
        paddingBottom: edge === "bottom" ? 8 : HOLDING.shadow,
      }}
    >
      <KeyCatcher onKey={(key) => key === "Escape" && onCancel()} />
      <Notice
        testID="holding"
        text={copy.line}
        action={
          <View style={{ flexDirection: "row", gap: 8 }}>
            <UiButton testID="holding-cancel" label="Cancel" onPress={onCancel} />
            <UiButton testID="holding-anyway" label={copy.anyway} onPress={onAnyway} />
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

export function AboutWindow({ info, onClose }: { info: AboutInfo; onClose: () => void }) {
  const colors = useColors();
  return (
    <Panel>
      <KeyCatcher onKey={(key) => key === "Escape" && onClose()} onSubmit={onClose} />
      {info.icon ? <Image source={info.icon} style={{ width: 64, height: 64 }} /> : <Svg markup={LOGO} size={56} color={colors.text} />}
      <Text style={{ fontSize: 18, fontWeight: "bold", color: colors.text, textAlign: "center" }}>{info.title}</Text>
      <View style={{ flexDirection: "column", alignItems: "center", gap: 2 }}>
        {info.lines.map((line) => (
          <Text key={line} style={{ fontSize: 12, color: colors.textMuted, textAlign: "center" }}>
            {line}
          </Text>
        ))}
      </View>
      <View style={{ alignSelf: "stretch", flexDirection: "row", marginTop: 6 }}>
        <Button testID="about-ok" label="OK" primary onPress={onClose} />
      </View>
    </Panel>
  );
}
